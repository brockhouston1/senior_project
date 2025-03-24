import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';

type MeditateScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export const MeditateScreen: React.FC<MeditateScreenProps> = ({ navigation }) => {
  const meditations = [
    {
      id: 1,
      title: 'Calm Mind',
      duration: '10 min',
      description: 'A gentle meditation for anxiety relief',
    },
    {
      id: 2,
      title: 'Deep Focus',
      duration: '15 min',
      description: 'Enhance your concentration and clarity',
    },
    {
      id: 3,
      title: 'Peaceful Sleep',
      duration: '20 min',
      description: 'Prepare your mind for restful sleep',
    },
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
          <Text style={styles.headerTitle}>Meditate</Text>
          <Text style={styles.headerSubtitle}>Find your inner peace</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.featuredContainer}>
          <TouchableOpacity style={styles.featuredCard}>
            <View style={styles.featuredContent}>
              <Text style={styles.featuredTitle}>Daily Meditation</Text>
              <Text style={styles.featuredDescription}>Start your day with a clear mind</Text>
              <View style={styles.featuredDuration}>
                <Text style={styles.durationText}>5 min</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Recommended</Text>
        {meditations.map(meditation => (
          <TouchableOpacity key={meditation.id} style={styles.meditationCard}>
            <View style={styles.meditationInfo}>
              <Text style={styles.meditationTitle}>{meditation.title}</Text>
              <Text style={styles.meditationDescription}>{meditation.description}</Text>
            </View>
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{meditation.duration}</Text>
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
  featuredContainer: {
    marginBottom: 24,
  },
  featuredCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    height: 160,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  featuredContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  featuredTitle: {
    fontSize: 24,
    color: '#333333',
    fontWeight: 'bold',
  },
  featuredDescription: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 8,
  },
  featuredDuration: {
    backgroundColor: '#f0f4f9',
    alignSelf: 'flex-start',
    borderRadius: 8,
    padding: 8,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 20,
    color: '#333333',
    fontWeight: 'bold',
    marginBottom: 16,
  },
  meditationCard: {
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
  meditationInfo: {
    flex: 1,
    marginRight: 12,
  },
  meditationTitle: {
    fontSize: 18,
    color: '#333333',
    fontWeight: '500',
  },
  meditationDescription: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  durationBadge: {
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