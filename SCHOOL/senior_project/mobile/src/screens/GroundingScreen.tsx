import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';

type GroundingScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export const GroundingScreen: React.FC<GroundingScreenProps> = ({ navigation }) => {
  const [activeStep, setActiveStep] = useState(1);

  const steps = [
    {
      number: 1,
      title: '5 Things You Can See',
      description: 'Look around and name 5 things you can see in your surroundings.',
    },
    {
      number: 2,
      title: '4 Things You Can Touch',
      description: 'Find and touch 4 different textures around you.',
    },
    {
      number: 3,
      title: '3 Things You Can Hear',
      description: 'Listen carefully and identify 3 different sounds.',
    },
    {
      number: 4,
      title: '2 Things You Can Smell',
      description: 'Notice 2 different scents in your environment.',
    },
    {
      number: 5,
      title: '1 Thing You Can Taste',
      description: 'Focus on one taste, even if it\'s just the taste in your mouth.',
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
          <Text style={styles.headerTitle}>Grounding</Text>
          <Text style={styles.headerSubtitle}>5-4-3-2-1 Technique</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What is Grounding?</Text>
          <Text style={styles.infoText}>
            Grounding is a technique that helps you stay in the present moment.
            It can help you calm down and regain focus when you're feeling
            overwhelmed or anxious.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Follow these steps:</Text>
        
        {steps.map((step) => (
          <TouchableOpacity
            key={step.number}
            style={[
              styles.stepCard,
              activeStep === step.number && styles.activeStepCard,
            ]}
            onPress={() => setActiveStep(step.number)}
          >
            <View style={styles.stepHeader}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{step.number}</Text>
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
            </View>
            <Text style={styles.stepDescription}>{step.description}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => setActiveStep(1)}
        >
          <Text style={styles.resetButtonText}>Start Over</Text>
        </TouchableOpacity>
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
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
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
    marginBottom: 8,
  },
  infoText: {
    fontSize: 16,
    color: '#8E8E93',
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 20,
    color: '#333333',
    fontWeight: 'bold',
    marginBottom: 16,
  },
  stepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  activeStepCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#8189E3',
    borderWidth: 2,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#8189E3',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stepTitle: {
    fontSize: 18,
    color: '#333333',
    fontWeight: '500',
  },
  stepDescription: {
    fontSize: 16,
    color: '#8E8E93',
    marginLeft: 44,
  },
  resetButton: {
    backgroundColor: '#8189E3',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginVertical: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
}); 