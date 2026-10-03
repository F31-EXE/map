import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as authModule from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/** Teams and live positions need Firebase; the map, imports and solo markers work without it. */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

// firebase/auth's typings describe only the web build; Metro resolves the React Native
// build (via @firebase/auth's "react-native" condition), which exports this.
const { getReactNativePersistence } = authModule as typeof authModule & {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase не настроен: заполните EXPO_PUBLIC_FIREBASE_* в .env');
  }
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function firebaseAuth(): Auth {
  if (!auth) {
    const a = ensureApp();
    auth =
      Platform.OS === 'web'
        ? getAuth(a)
        : initializeAuth(a, { persistence: getReactNativePersistence(AsyncStorage) });
  }
  return auth;
}

export function firestore(): Firestore {
  if (!db) db = getFirestore(ensureApp());
  return db;
}
