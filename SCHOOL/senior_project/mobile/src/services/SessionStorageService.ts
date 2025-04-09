import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, SessionMetadata } from '../types/SessionTypes';

const SESSIONS_KEY = '@sessions';
const SESSION_METADATA_KEY = '@session_metadata';

class SessionStorageService {
  // Save a new session
  async saveSession(session: Session): Promise<void> {
    try {
      // Get existing sessions
      const existingSessions = await this.getAllSessions();
      
      // Add new session
      existingSessions[session.id] = session;
      
      // Save updated sessions
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(existingSessions));
      
      // Update metadata
      await this.updateSessionMetadata(session);
    } catch (error) {
      console.error('Error saving session:', error);
      throw error;
    }
  }

  // Get all sessions
  async getAllSessions(): Promise<{ [key: string]: Session }> {
    try {
      const sessions = await AsyncStorage.getItem(SESSIONS_KEY);
      return sessions ? JSON.parse(sessions) : {};
    } catch (error) {
      console.error('Error getting sessions:', error);
      return {};
    }
  }

  // Get a single session by ID
  async getSessionById(id: string): Promise<Session | null> {
    try {
      const sessions = await this.getAllSessions();
      return sessions[id] || null;
    } catch (error) {
      console.error('Error getting session by ID:', error);
      return null;
    }
  }

  // Get all session metadata
  async getAllSessionMetadata(): Promise<SessionMetadata[]> {
    try {
      const metadata = await AsyncStorage.getItem(SESSION_METADATA_KEY);
      return metadata ? JSON.parse(metadata) : [];
    } catch (error) {
      console.error('Error getting session metadata:', error);
      return [];
    }
  }

  // Update session metadata
  private async updateSessionMetadata(session: Session): Promise<void> {
    try {
      const metadata: SessionMetadata = {
        id: session.id,
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        summary: session.summary,
        tags: session.tags,
        isArchived: session.isArchived,
        lastModified: session.lastModified,
        messageCount: session.messages.length
      };

      const existingMetadata = await this.getAllSessionMetadata();
      const index = existingMetadata.findIndex(m => m.id === session.id);
      
      if (index >= 0) {
        existingMetadata[index] = metadata;
      } else {
        existingMetadata.push(metadata);
      }

      await AsyncStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(existingMetadata));
    } catch (error) {
      console.error('Error updating session metadata:', error);
      throw error;
    }
  }

  // Delete a session
  async deleteSession(id: string): Promise<void> {
    try {
      const sessions = await this.getAllSessions();
      delete sessions[id];
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));

      const metadata = await this.getAllSessionMetadata();
      const updatedMetadata = metadata.filter(m => m.id !== id);
      await AsyncStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(updatedMetadata));
    } catch (error) {
      console.error('Error deleting session:', error);
      throw error;
    }
  }

  // Archive a session
  async archiveSession(id: string): Promise<void> {
    try {
      const sessions = await this.getAllSessions();
      if (sessions[id]) {
        sessions[id].isArchived = true;
        sessions[id].lastModified = new Date().toISOString();
        await this.saveSession(sessions[id]);
      }
    } catch (error) {
      console.error('Error archiving session:', error);
      throw error;
    }
  }
}

export default new SessionStorageService(); 