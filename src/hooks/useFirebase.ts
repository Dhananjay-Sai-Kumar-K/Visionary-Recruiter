import { useState, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import type { SessionData, StarMetrics, InterviewTranscript } from '../types/index';

export function useFirebase() {
  const [db, setDb] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string>('');

  const connect = useCallback((apiKey: string, projectId: string, appId: string) => {
    try {
      const app = initializeApp({ apiKey, projectId, appId }, 'rec-' + Date.now());
      const firestore = getFirestore(app);
      setDb(firestore);
      setIsConnected(true);
      setError('');
    } catch (e: any) {
      setError(e.message);
      setIsConnected(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!db) return;
    try {
      const q = query(collection(db, 'sessions'), orderBy('startedAt', 'desc'));
      const snap = await getDocs(q);
      const loaded: SessionData[] = [];
      snap.forEach(d => {
        loaded.push({ id: d.id, ...d.data() } as SessionData);
      });
      setSessions(loaded);
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    }
  }, [db]);

  const startSession = useCallback(async () => {
    if (!db) return;
    try {
      const ref = await addDoc(collection(db, 'sessions'), { 
        startedAt: serverTimestamp(), 
        status: 'in_progress', 
        transcript: [], 
        finalMetrics: null 
      });
      setSessionId(ref.id);
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    }
  }, [db]);

  const saveMetric = useCallback(async (metrics: StarMetrics) => {
    if (!db || !sessionId) return;
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { finalMetrics: metrics });
    } catch (e: any) {
      console.error(e);
    }
  }, [db, sessionId]);

  const addTranscript = useCallback(async (role: 'user' | 'sarah', text: string) => {
    if (!text?.trim() || !db || !sessionId) return;
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { 
        transcript: arrayUnion({ role, text: text.trim(), ts: new Date().toISOString() }) 
      });
    } catch (e: any) {
      console.error(e);
    }
  }, [db, sessionId]);

  const endSession = useCallback(async (finalMetrics: StarMetrics | null) => {
    if (!db || !sessionId) return;
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { 
        status: 'completed', 
        endedAt: serverTimestamp(), 
        finalMetrics 
      });
      setSessionId(null);
    } catch (e: any) {
      console.error(e);
    }
  }, [db, sessionId]);

  return {
    connect,
    loadHistory,
    startSession,
    saveMetric,
    addTranscript,
    endSession,
    sessions,
    isConnected,
    error,
    sessionId
  };
}
