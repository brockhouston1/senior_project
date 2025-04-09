import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useFocusEffect } from '@react-navigation/native';
import SessionStorageService from '../services/SessionStorageService';
import { SessionMetadata } from '../types/SessionTypes';

type SessionsScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export const SessionsScreen: React.FC<SessionsScreenProps> = ({ navigation }) => {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalTime: 0
  });

  // Load sessions on initial mount
  useEffect(() => {
    loadSessions();
  }, []);
  
  // Refresh data when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      console.log('Sessions screen focused, reloading data');
      loadSessions();
      return () => {
        // cleanup if needed
      };
    }, [])
  );

  const loadSessions = async () => {
    try {
      setLoading(true);
      const metadata = await SessionStorageService.getAllSessionMetadata();
      console.log(`Loaded ${metadata.length} sessions`);
      
      // Sort sessions by date (newest first)
      const sortedSessions = metadata.sort((a, b) => 
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );

      // Calculate stats
      const totalTime = sortedSessions.reduce((acc, session) => 
        acc + (session.duration || 0), 0
      );

      setSessions(sortedSessions);
      setStats({
        totalSessions: sortedSessions.length,
        totalTime: Math.round(totalTime / 3600 * 10) / 10 // Convert to hours with 1 decimal
      });
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearAllSessions = async () => {
    Alert.alert(
      "Clear All Sessions",
      "Are you sure you want to delete all sessions? This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              // Get all sessions
              const allSessions = await SessionStorageService.getAllSessionMetadata();
              
              // Delete each session
              for (const session of allSessions) {
                await SessionStorageService.deleteSession(session.id);
              }
              
              // Reload sessions
              loadSessions();
              
              // Show confirmation
              Alert.alert("Success", "All sessions have been cleared.");
            } catch (error) {
              console.error('Error clearing sessions:', error);
              Alert.alert("Error", "Failed to clear all sessions.");
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return '0 min';
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  };

  const handleSessionPress = (sessionId: string) => {
    navigation.navigate('SessionDetail', { sessionId });
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#8189E3" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.openDrawer()}
          style={styles.menuButton}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>Sessions</Text>
          <Text style={styles.headerSubtitle}>Your wellness journey</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.totalSessions}</Text>
            <Text style={styles.statLabel}>Total Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.totalTime}h</Text>
            <Text style={styles.statLabel}>Time Spent</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Sessions</Text>
          {sessions.length > 0 && (
            <TouchableOpacity 
              style={styles.clearButton}
              onPress={clearAllSessions}
            >
              <Text style={styles.clearButtonText}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>

        {sessions.length === 0 ? (
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyStateText}>No sessions yet</Text>
            <Text style={styles.emptyStateSubText}>
              Your conversations will be saved here after you talk with the assistant
            </Text>
          </View>
        ) : (
          sessions.map(session => (
            <TouchableOpacity 
              key={session.id} 
              style={styles.sessionCard}
              onPress={() => handleSessionPress(session.id)}
            >
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionDate}>{formatDate(session.startTime)}</Text>
                <Text style={styles.sessionType}>{session.title || 'Untitled Session'}</Text>
              </View>
              <View style={styles.sessionDuration}>
                <Text style={styles.durationText}>{formatDuration(session.duration)}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f9',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 60,
    marginBottom: 16,
    padding: 16,
  },
  menuButton: {
    padding: 8,
    paddingTop: 4,
  },
  menuIcon: {
    fontSize: 40,
    color: '#8189E3',
  },
  headerTextContainer: {
    marginLeft: 16,
  },
  headerTitle: {
    fontSize: 36,
    color: '#8189E3',
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    color: '#8189E3',
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  sectionTitle: {
    fontSize: 20,
    color: '#333333',
    fontWeight: 'bold',
  },
  clearButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  clearButtonText: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '600'
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionDate: {
    fontSize: 16,
    color: '#333333',
    fontWeight: '500',
  },
  sessionType: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  sessionDuration: {
    backgroundColor: '#f0f4f9',
    borderRadius: 8,
    padding: 8,
  },
  durationText: {
    color: '#8189E3',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyStateContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginTop: 16
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8
  },
  emptyStateSubText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20
  }
}); 