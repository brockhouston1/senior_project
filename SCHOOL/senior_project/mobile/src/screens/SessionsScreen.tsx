import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';

type SessionsScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export const SessionsScreen: React.FC<SessionsScreenProps> = ({ navigation }) => {
  // Mock data for sessions
  const sessions = [
    { id: 1, date: 'March 12, 2024', duration: '15 min', type: 'Breathing Exercise' },
    { id: 2, date: 'March 10, 2024', duration: '10 min', type: 'Grounding' },
    { id: 3, date: 'March 8, 2024', duration: '20 min', type: 'Meditation' },
  ];

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
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Total Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>3.5h</Text>
            <Text style={styles.statLabel}>Time Spent</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Recent Sessions</Text>
        {sessions.map(session => (
          <TouchableOpacity key={session.id} style={styles.sessionCard}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionDate}>{session.date}</Text>
              <Text style={styles.sessionType}>{session.type}</Text>
            </View>
            <View style={styles.sessionDuration}>
              <Text style={styles.durationText}>{session.duration}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f9',
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
  sectionTitle: {
    fontSize: 20,
    color: '#333333',
    fontWeight: 'bold',
    marginBottom: 16,
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
}); 