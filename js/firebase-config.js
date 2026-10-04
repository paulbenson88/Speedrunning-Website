// Copy your Firebase web app config into this object.
// You can get it from Firebase Console -> Project settings -> General -> Your apps.
// This file is loaded by submit.html before submit.js.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCXHyGdfTxf7stFtIGxSVeOwpfEzB9-Txc",
  authDomain: "speedrun-website-c9c0e.firebaseapp.com",
  projectId: "speedrun-website-c9c0e",
  storageBucket: "speedrun-website-c9c0e.firebasestorage.app",
  messagingSenderId: "529238397970",
  appId: "1:529238397970:web:d387d454be7901170034cb",
  measurementId: "G-E374EH6FEH"
};

// Owner accounts that can edit VODs, access Submit Updates, and publish homepage edits.
// Use one or both lists below.
// Example: window.FIREBASE_OWNER_EMAILS = ["you@gmail.com"];
// Example: window.FIREBASE_OWNER_UIDS = ["firebase-auth-uid"];
// Homepage publishing also requires matching owner values in firestore.rules and deployed rules.
window.FIREBASE_OWNER_EMAILS = [
  "paulbenson108@gmail.com"
];

window.FIREBASE_OWNER_UIDS = [
  "5vM0JDJ6qiRFsJkZ7d24eNE8lNs1"
];
