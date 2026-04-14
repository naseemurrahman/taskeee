// App.tsx - React Native entry point
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider } from 'react-redux';
import { StatusBar } from 'react-native';
import { store } from './src/store';
import { useAppSelector, useAppDispatch } from './src/store/hooks';
import { restoreSession } from './src/store/authSlice';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import TaskListScreen from './src/screens/TaskListScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import PhotoUploadScreen from './src/screens/PhotoUploadScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TeamScreen from './src/screens/TeamScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

// Tab Icons
import TasksIcon from './src/components/icons/TasksIcon';
import DashboardIcon from './src/components/icons/DashboardIcon';
import TeamIcon from './src/components/icons/TeamIcon';
import NotifIcon from './src/components/icons/NotifIcon';
import ProfileIcon from './src/components/icons/ProfileIcon';

import { COLORS } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { user } = useAppSelector(s => s.auth);
  const isManager = ['supervisor','manager','director','admin'].includes(user?.role || '');

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          borderTopWidth: 0.5,
          borderTopColor: COLORS.border,
          paddingBottom: 6,
          paddingTop: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter-Medium' }
      }}
    >
      <Tab.Screen name="Tasks" component={TaskListScreen}
        options={{ tabBarIcon: ({ color }) => <TasksIcon color={color} /> }} />
      {isManager && (
        <Tab.Screen name="Dashboard" component={DashboardScreen}
          options={{ tabBarIcon: ({ color }) => <DashboardIcon color={color} /> }} />
      )}
      {isManager && (
        <Tab.Screen name="Team" component={TeamScreen}
          options={{ tabBarIcon: ({ color }) => <TeamIcon color={color} /> }} />
      )}
      <Tab.Screen name="Notifications" component={NotificationsScreen}
        options={{ tabBarIcon: ({ color }) => <NotifIcon color={color} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarIcon: ({ color }) => <ProfileIcon color={color} /> }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { isAuthenticated, loading } = useAppSelector(s => s.auth);
  const dispatch = useAppDispatch();

  useEffect(() => { dispatch(restoreSession()); }, []);

  if (loading) return null; // Splash screen

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="TaskDetail" component={TaskDetailScreen}
            options={{ presentation: 'card', headerShown: true, title: 'Task Details' }} />
          <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen}
            options={{ presentation: 'modal', headerShown: true, title: 'Submit Photo Proof' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <NavigationContainer>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <RootNavigator />
      </NavigationContainer>
    </Provider>
  );
}
