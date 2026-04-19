import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB1SC7BbpKs0uOzuJXSsZgouvuknmS2tao",
  authDomain: "mj-store-a8279.firebaseapp.com",
  projectId: "mj-store-a8279",
  storageBucket: "mj-store-a8279.firebasestorage.app",
  messagingSenderId: "158826116383",
  appId: "1:158826116383:web:3b29282c712aa558d62c2a",
  measurementId: "G-FX4GKJ1BWH"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
