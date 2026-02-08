import { useContext } from 'react';
import { GmailAuthContext } from '../context/GmailAuthContext';

export function useGmailAuth() {
  return useContext(GmailAuthContext);
}
