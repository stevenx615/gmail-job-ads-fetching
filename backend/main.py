import asyncio
import io
import json
import re
from typing import List

import httpx
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Contact info detection
CONTACT_RE = re.compile(
    r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}"         # email
    r"|(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}"  # phone
    r"|linkedin\.com"                          # LinkedIn
    r"|github\.com"                            # GitHub
    r"|gitlab\.com"
    r"|portfolio|website|http",
    re.IGNORECASE,
)

# Known resume section titles — used to detect section boundaries in resumes
# that do not use Word heading styles
SECTION_TITLES_RE = re.compile(
    r"^(summary|profile|objective|highlights?"
    r"|experience|work experience|work history|professional experience|employment history"
    r"|education|academic background|academic history"
    r"|skills|technical skills|core competencies|key skills|areas of expertise"
    r"|projects?|personal projects?|side projects?"
    r"|certifications?|licenses?|credentials?"
    r"|awards?|honors?|achievements?"
    r"|publications?|research"
    r"|volunteer(ing)?|community service|community involvement"
    r"|languages?"
    r"|interests?|hobbies|activities"
    r"|references?)$",
    re.IGNORECASE,
)


def looks_like_section_title(text: str) -> bool:
    """Return True if the text looks like a resume section heading."""
    stripped = text.strip()
    if not stripped or len(stripped) > 50:
        return False
    # All-uppercase short line (common in template resumes, e.g. "EXPERIENCE")
    if stripped.isupper() and len(stripped) >= 3:
        return True
    # Exact match against known section names
    return bool(SECTION_TITLES_RE.match(stripped))


def classify_paragraphs(doc: Document) -> List[str]:
    """
    Classify every paragraph in the document into one of:
      "heading"  – section title or name heading (preserve, never edit)
      "header"   – name / contact info block at top (preserve)
      "content"  – editable body text (bullet points, descriptions, summary)
      "empty"    – blank line (preserve for spacing)

    Three-phase logic
    -----------------
    Phase 1  (before any heading)     – everything is "header" (name/contact zone)
    Phase 2  (after first heading)    – still "header" until we see a *section* heading
    Phase 3  (after a section heading) – "content", unless it looks like contact info
                                         or another section title
    """
    results = []
    first_heading_seen = False  # have we seen any heading at all?
    content_zone = False        # have we seen a section heading (h2+, or text-based)?

    for para in doc.paragraphs:
        text = para.text.strip()
        style_name = (para.style.name or "").lower()
        is_heading_style = "heading" in style_name

        if not text:
            results.append("empty")

        elif is_heading_style:
            if not first_heading_seen:
                # First heading = the candidate's name; stay in contact zone
                first_heading_seen = True
            else:
                # Second+ heading = section title; enter content zone
                content_zone = True
            results.append("heading")

        elif not first_heading_seen:
            # Phase 1: no heading seen yet – check for text-based section title
            # (resumes that never use Word heading styles, e.g., all-caps sections)
            if looks_like_section_title(text):
                first_heading_seen = True
                content_zone = True
                results.append("heading")
            else:
                results.append("header")

        elif not content_zone:
            # Phase 2: after name heading but before any section heading
            # This is the contact-info zone (address, phone, LinkedIn, etc.)
            if looks_like_section_title(text):
                content_zone = True
                results.append("heading")
            else:
                results.append("header")

        else:
            # Phase 3: content zone
            if CONTACT_RE.search(text):
                results.append("header")
            elif looks_like_section_title(text):
                # Section titles within the body (e.g., "EXPERIENCE" without heading style)
                results.append("heading")
            else:
                results.append("content")

    return results


class Section(BaseModel):
    index: int
    type: str
    text: str


class ExtractResponse(BaseModel):
    sections: List[Section]


@app.post("/api/extract-sections", response_model=ExtractResponse)
async def extract_sections(file: UploadFile = File(...)):
    data = await file.read()
    doc = Document(io.BytesIO(data))

    types = classify_paragraphs(doc)
    sections = [
        Section(index=i, type=types[i], text=doc.paragraphs[i].text)
        for i in range(len(doc.paragraphs))
    ]
    return ExtractResponse(sections=sections)


class Replacement(BaseModel):
    index: int
    new_text: str


@app.post("/api/rebuild-docx")
async def rebuild_docx(
    file: UploadFile = File(...),
    replacements: str = Form(...),
):
    data = await file.read()
    doc = Document(io.BytesIO(data))

    repl_list: List[Replacement] = [Replacement(**r) for r in json.loads(replacements)]
    repl_map = {r.index: r.new_text for r in repl_list}

    for idx, new_text in repl_map.items():
        if idx < 0 or idx >= len(doc.paragraphs):
            continue
        para = doc.paragraphs[idx]

        # Capture first run's font properties before clearing
        font_name = None
        font_size = None
        font_bold = None
        font_italic = None
        font_color = None

        if para.runs:
            first_run = para.runs[0]
            font_name = first_run.font.name
            font_size = first_run.font.size
            font_bold = first_run.font.bold
            font_italic = first_run.font.italic
            try:
                font_color = first_run.font.color.rgb if first_run.font.color.type else None
            except Exception:
                font_color = None

        # Clear all run text (keeps paragraph-level formatting: indent, bullet, spacing)
        for run in para.runs:
            run.text = ""

        # Write the new text into the first run (or a new one if none exist)
        if para.runs:
            para.runs[0].text = new_text
            run = para.runs[0]
        else:
            run = para.add_run(new_text)

        # Re-apply captured font properties
        if font_name:
            run.font.name = font_name
        if font_size:
            run.font.size = font_size
        if font_bold is not None:
            run.font.bold = font_bold
        if font_italic is not None:
            run.font.italic = font_italic
        if font_color is not None:
            try:
                run.font.color.rgb = font_color
            except Exception:
                pass

    output = io.BytesIO()
    doc.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": "attachment; filename=tailored_resume.docx"},
    )


# ── Job Scraper ───────────────────────────────────────────────────────────────

class ScrapeJobRequest(BaseModel):
    url: str


_JOB_TYPE_RE = re.compile(
    r'\b(full[- ]?time|part[- ]?time|contract|temporary|temp|internship|intern|permanent|casual|seasonal|freelance|per diem|fixed[- ]?term|volunteer)\b',
    re.IGNORECASE,
)

def _clean_job_type(raw: str) -> str:
    """Extract the first recognisable employment-type term from noisy scraped text."""
    m = _JOB_TYPE_RE.search(raw)
    if m:
        return m.group(0).title()
    # Fallback: first non-empty line, capped at 30 chars
    first = next((ln.strip() for ln in raw.splitlines() if ln.strip()), raw.strip())
    return first[:30]


def _detect_source(url: str) -> str:
    if "linkedin.com" in url:
        return "linkedin"
    if "indeed.com" in url:
        return "indeed"
    if "glassdoor." in url:
        return "glassdoor"
    return "generic"


def _inner_html(el_list) -> str:
    """Return inner HTML of the first matched element, trying multiple scrapling/parsel APIs."""
    if not el_list:
        return ""

    import re

    def strip_outer_tag(html: str) -> str:
        inner = re.sub(r'^<[^>]*>', '', html, count=1, flags=re.DOTALL)
        inner = re.sub(r'</[a-zA-Z][a-zA-Z0-9-]*>\s*$', '', inner.strip())
        return inner.strip()

    # Method 1: SelectorList.getall() — parsel idiom; returns list of outer-HTML strings
    try:
        htmls = el_list.getall()
        if htmls and isinstance(htmls[0], str) and '<' in htmls[0]:
            stripped = strip_outer_tag(htmls[0])
            if stripped:
                return stripped
    except Exception:
        pass

    el = el_list[0]

    # Method 2: element .get() — parsel Selector method
    try:
        outer = el.get()
        if outer and isinstance(outer, str) and '<' in outer:
            stripped = strip_outer_tag(outer)
            if stripped:
                return stripped
    except Exception:
        pass

    # Method 3: .html attribute — selectolax / some scrapling versions
    try:
        html = getattr(el, 'html', None)
        if html and isinstance(html, str) and '<' in html:
            stripped = strip_outer_tag(html)
            if stripped:
                return stripped
    except Exception:
        pass

    # Method 4: lxml .root
    try:
        from lxml import etree
        root = el.root
        result = ''.join(etree.tostring(child, encoding='unicode') for child in root)
        if result:
            return result
    except Exception:
        pass

    return el.get_all_text().strip()


def _txt(page, sel: str) -> str:
    el = page.css(sel)
    return el[0].get_all_text().strip() if el else ""


def _scrape_linkedin(page) -> dict:
    # Title — try specific class first, then generic h1
    title = (
        page.css("h1.top-card-layout__title::text").get("").strip()
        or page.css("h1.topcard__title::text").get("").strip()
        or page.css("h1::text").get("").strip()
    )
    # Company
    company = (
        page.css(".topcard__org-name-link::text").get("").strip()
        or page.css(".top-card-layout__card .topcard__flavor--black-link::text").get("").strip()
        or page.css("[class*='company-name']::text").get("").strip()
    )
    # Location
    location = (
        page.css(".topcard__flavor--bullet::text").get("").strip()
        or page.css("[class*='topcard__flavor']::text").get("").strip()
        or page.css("[class*='location']::text").get("").strip()
    )
    # Job type from criteria list
    job_type = ""
    for item in page.css(".description__job-criteria-item"):
        label = item.css("h3::text").get("").strip()
        value = item.css(".description__job-criteria-text::text").get("").strip()
        if label.lower() in ("employment type", "job type") and value:
            job_type = _clean_job_type(value)
    # Description — try selectors in order, take first with >100 chars
    description = ""
    for sel in [
        "[data-testid='expandable-text-box']",
        ".show-more-less-html__markup",
        "#job-details",
        "[class*='description__text--rich']",
        "[class*='job-details-description']",
        "[class*='description__text']",
        "article[class*='jobs-description']",
        "[class*='jobs-description__content']",
        ".description",
    ]:
        el = page.css(sel)
        if el:
            candidate = _inner_html(el) or el[0].get_all_text().strip()
            if len(candidate) > 100:
                description = candidate
                break
    return {"title": title, "company": company, "location": location, "jobType": job_type, "salary": "", "description": description}


_SALARY_RE = re.compile(
    r'(?:CA\s*)?\$[\d,]+(?:\s*[–—\-]\s*(?:CA\s*)?\$?[\d,]+)?\s*'
    r'(?:an?\s+hour|per\s+hour|/\s*hr\.?|hourly|a\s+year|per\s+year|/\s*yr\.?|annually)',
    re.IGNORECASE,
)

def _extract_salary(raw: str, page) -> str:
    """Try raw text first, then fall back to list-item elements."""
    m = _SALARY_RE.search(raw)
    if m:
        return m.group(0).strip()
    salary_els = page.css("[data-testid='list-item']::text").getall()
    return next((s.strip() for s in salary_els if re.search(r'\$|hour|year|salary', s, re.IGNORECASE)), "")

def _scrape_indeed(page) -> dict:
    title    = _txt(page, "[data-testid='jobsearch-JobInfoHeader-title']")
    company  = _txt(page, "[data-testid='inlineHeader-companyName']")
    location = _txt(page, "[data-testid='inlineHeader-companyLocation']")
    raw_details = _txt(page, "[data-testid='jobsearch-OtherJobDetailsContainer']")
    job_type = _clean_job_type(raw_details)
    salary   = _extract_salary(raw_details, page)
    desc_el  = page.css("#jobDescriptionText")
    description = _inner_html(desc_el)
    return {"title": title, "company": company, "location": location, "jobType": job_type, "salary": salary, "description": description}


def _scrape_glassdoor(page) -> dict:
    title    = _txt(page, "[data-test='job-title']") or _txt(page, "h1")
    company  = (_txt(page, "[class*='employerNameHeading']")
                or _txt(page, "[data-test='employer-name']")
                or _txt(page, "[class*='employerName']"))
    location = _txt(page, "[data-test='emp-location']") or _txt(page, "[class*='location']")
    salary   = _txt(page, "[data-test='detailSalary']") or _txt(page, "[class*='salary']")
    job_type = _clean_job_type(_txt(page, "[data-test='employment-type']") or _txt(page, "[class*='employmentType']"))
    desc_el  = (
        page.css("[class*='jobDescription']")
        or page.css("[class*='jobDescriptionContent']")
        or page.css("#JobDescriptionContainer")
        or page.css("[data-test='jobDescriptionText']")
    )
    description = _inner_html(desc_el)
    return {"title": title, "company": company, "location": location, "jobType": job_type, "salary": salary, "description": description}


def _scrape_generic(page) -> dict:
    title    = page.css("h1::text").get("").strip()
    company  = ""
    location = ""
    description = ""
    for sel in ["[class*='jobDescription']", "[class*='job-description']", "[class*='description']", "main", "article"]:
        el = page.css(sel)
        if el:
            candidate = _inner_html(el) or el[0].get_all_text().strip()
            if len(candidate) > 100:
                description = candidate
                break
    return {"title": title, "company": company, "location": location, "jobType": "", "salary": "", "description": description}


@app.post("/api/scrape-job")
async def scrape_job(req: ScrapeJobRequest):
    try:
        from scrapling.fetchers import DynamicFetcher
    except ImportError:
        raise HTTPException(status_code=503, detail="scrapling not installed — run: pip install scrapling")

    url = req.url
    # Normalise Indeed redirect/listing URLs (handles jk=, vjk=, ca.indeed.com, etc.)
    if "indeed.com" in url and "viewjob" not in url:
        from urllib.parse import urlparse, parse_qs
        _parsed = urlparse(url)
        _qs = parse_qs(_parsed.query)
        jk = (_qs.get("jk") or _qs.get("vjk") or [None])[0]
        if jk:
            url = f"https://{_parsed.netloc}/viewjob?jk={jk}"

    source = _detect_source(url)
    wait_ms = 8000 if source == "glassdoor" else 6000 if source == "linkedin" else 5000

    try:
        # DynamicFetcher uses Playwright sync API — run in a thread to avoid asyncio conflict
        page = await asyncio.to_thread(lambda: DynamicFetcher.fetch(url, wait=wait_ms))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch page: {exc}")

    if source == "linkedin":
        result = _scrape_linkedin(page)
    elif source == "indeed":
        result = _scrape_indeed(page)
    elif source == "glassdoor":
        result = _scrape_glassdoor(page)
    else:
        result = _scrape_generic(page)

    if not result.get("description"):
        raise HTTPException(status_code=422, detail="Could not extract job description from the page")

    return result


# ── AI Complete (server-side) ──────────────────────────────────────────────────
# Calls AI providers server-side so the browser never needs CORS access.
# Used by Resume Tailoring feature.

class AICompleteRequest(BaseModel):
    provider: str
    apiKey: str
    model: str
    prompt: str
    maxTokens: int = 4096


@app.post("/api/ai/complete")
async def ai_complete(req: AICompleteRequest):
    async with httpx.AsyncClient(timeout=120.0) as client:
        if req.provider == "anthropic":
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": req.apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": req.model,
                    "max_tokens": req.maxTokens,
                    "messages": [{"role": "user", "content": req.prompt}],
                },
            )
            if not resp.is_success:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            text = resp.json()["content"][0]["text"]

        elif req.provider == "openai":
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {req.apiKey}",
                    "content-type": "application/json",
                },
                json={
                    "model": req.model,
                    "messages": [{"role": "user", "content": req.prompt}],
                    "temperature": 0.3,
                },
            )
            if not resp.is_success:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            text = resp.json()["choices"][0]["message"]["content"]

        elif req.provider == "gemini":
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{req.model}:generateContent?key={req.apiKey}"
            )
            resp = await client.post(
                url,
                headers={"content-type": "application/json"},
                json={"contents": [{"parts": [{"text": req.prompt}]}]},
            )
            if not resp.is_success:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]

        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    return {"text": text}


# ── AI API Proxy ──────────────────────────────────────────────────────────────
# Forwards browser requests to Anthropic / OpenAI, bypassing browser CORS restrictions.
# Usage: set Proxy URL in Settings to http://localhost:8000/api/proxy/anthropic
#                                   or http://localhost:8000/api/proxy/openai

_PROXY_TARGETS = {
    "anthropic": "https://api.anthropic.com",
    "openai":    "https://api.openai.com",
}

_FORWARD_HEADERS = {
    "authorization", "x-api-key", "anthropic-version",
    "content-type", "anthropic-dangerous-direct-browser-access",
}


@app.api_route("/api/proxy/{provider}/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def ai_proxy(provider: str, path: str, request: Request):
    if provider not in _PROXY_TARGETS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    target_url = f"{_PROXY_TARGETS[provider]}/{path}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() in _FORWARD_HEADERS}

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
        )

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )
