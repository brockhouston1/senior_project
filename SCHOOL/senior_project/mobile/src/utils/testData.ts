import { Session } from '../types/SessionTypes';

export const createTestSession = (): Session => ({
  id: Date.now().toString(),
  title: 'Test Session',
  startTime: new Date().toISOString(),
  endTime: new Date(Date.now() + 15 * 60000).toISOString(),
  duration: 900,
  messages: [
    {
      role: 'user',
      content: 'Hello, I need some help with anxiety.',
      timestamp: new Date().toISOString()
    },
    {
      role: 'assistant',
      content: "I understand you're feeling anxious. Can you tell me more about what's triggering these feelings?",
      timestamp: new Date(Date.now() + 1000).toISOString()
    },
    {
      role: 'user',
      content: "I have a big presentation tomorrow and I'm feeling overwhelmed.",
      timestamp: new Date(Date.now() + 2000).toISOString()
    },
    {
      role: 'assistant',
      content: "That's a common source of anxiety. Let's work through some breathing exercises together. Would you like to try that?",
      timestamp: new Date(Date.now() + 3000).toISOString()
    }
  ],
  summary: 'Discussion about presentation anxiety and potential coping strategies.',
  tags: ['anxiety', 'work', 'presentation'],
  isArchived: false,
  lastModified: new Date().toISOString()
});

export const createMultipleTestSessions = (count: number): Session[] => {
  return Array.from({ length: count }, (_, index) => ({
    ...createTestSession(),
    id: `test-${Date.now()}-${index}`,
    title: `Test Session ${index + 1}`,
    startTime: new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString(), // Each session 1 day apart
    endTime: new Date(Date.now() - index * 24 * 60 * 60 * 1000 + 15 * 60000).toISOString(),
    tags: ['test', `session-${index + 1}`]
  }));
}; 