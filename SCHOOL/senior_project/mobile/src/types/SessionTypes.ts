export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  duration?: number; // in seconds
  messages: Message[];
  summary?: string;
  tags?: string[];
  isArchived: boolean;
  lastModified: string;
}

export interface SessionMetadata {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  summary?: string;
  tags?: string[];
  isArchived: boolean;
  lastModified: string;
  messageCount: number;
} 