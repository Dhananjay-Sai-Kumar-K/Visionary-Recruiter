export interface FaceMeshMetrics {
  eyeContact: number;
  tilt: number;
  smile: number;
  blinkRate: number;
  jawTension: number;
  stress: number;
}

export interface StarMetrics {
  confidence: number;
  star_situation: number;
  star_task: number;
  star_action: number;
  star_result: number;
  articulation: number;
  feedback?: string;
}

export interface InterviewTranscript {
  role: 'user' | 'sarah';
  text: string;
  ts?: string;
}

export interface SessionData {
  id?: string;
  startedAt: any; // Firestore Timestamp
  endedAt?: any;
  status: 'in_progress' | 'completed';
  transcript: InterviewTranscript[];
  finalMetrics?: StarMetrics | null;
}
