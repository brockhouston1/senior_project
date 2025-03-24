import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';

type BreathingScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export const BreathingScreen: React.FC<BreathingScreenProps> = ({ navigation }) => {
  const [isActive, setIsActive] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('Get Ready');
  const breathAnimation = new Animated.Value(1);

  useEffect(() => {
    if (isActive) {
      startBreathingAnimation();
    }
  }, [isActive]);

  const startBreathingAnimation = () => {
    const breatheIn = Animated.timing(breathAnimation, {
      toValue: 1.5,
      duration: 4000,
      useNativeDriver: true,
    });

    const holdBreath = Animated.timing(breathAnimation, {
      toValue: 1.5,
      duration: 4000,
      useNativeDriver: true,
    });

    const breatheOut = Animated.timing(breathAnimation, {
      toValue: 1,
      duration: 4000,
      useNativeDriver: true,
    });

    const sequence = Animated.sequence([breatheIn, holdBreath, breatheOut]);

    Animated.loop(sequence).start();
  };

  const toggleBreathing = () => {
    setIsActive(!isActive);
    if (!isActive) {
      setCurrentPhase('Breathe In');
      startBreathingAnimation();
    } else {
      breathAnimation.stopAnimation();
      setCurrentPhase('Get Ready');
    }
  };

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
          <Text style={styles.headerTitle}>Breathe</Text>
          <Text style={styles.headerSubtitle}>Take a moment to relax</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.breathingContainer}>
          <Animated.View
            style={[
              styles.breathingCircle,
              {
                transform: [{ scale: breathAnimation }],
              },
            ]}
          />
          <Text style={styles.phaseText}>{currentPhase}</Text>
        </View>

        <TouchableOpacity
          style={[styles.startButton, isActive && styles.stopButton]}
          onPress={toggleBreathing}
        >
          <Text style={styles.buttonText}>
            {isActive ? 'Stop' : 'Start Breathing Exercise'}
          </Text>
        </TouchableOpacity>

        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>How to practice:</Text>
          <Text style={styles.infoText}>1. Find a comfortable position</Text>
          <Text style={styles.infoText}>2. Follow the circle's rhythm</Text>
          <Text style={styles.infoText}>3. Breathe in as it expands</Text>
          <Text style={styles.infoText}>4. Hold when it pauses</Text>
          <Text style={styles.infoText}>5. Breathe out as it contracts</Text>
        </View>
      </View>
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
    alignItems: 'center',
    padding: 16,
  },
  breathingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breathingCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#8189E3',
    opacity: 0.8,
  },
  phaseText: {
    fontSize: 24,
    color: '#333333',
    marginTop: 32,
    fontWeight: '500',
  },
  startButton: {
    backgroundColor: '#8189E3',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  stopButton: {
    backgroundColor: '#FF6B6B',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '500',
  },
  infoContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  infoTitle: {
    fontSize: 18,
    color: '#333333',
    fontWeight: '500',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 8,
  },
}); 