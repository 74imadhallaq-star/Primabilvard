// Firebase config for primabilvard-6c99e
// Uses compat SDK because script.js is written with db.collection(...)
const firebaseConfig = {
  apiKey: "AIzaSyAD1eXQlseZnyCAT5hJPyDEf2BCHMQb1jI",
  authDomain: "primabilvard-6c99e.firebaseapp.com",
  projectId: "primabilvard-6c99e",
  storageBucket: "primabilvard-6c99e.firebasestorage.app",
  messagingSenderId: "989347315654",
  appId: "1:989347315654:web:c35209e7f9a65fb2eb7cc7"
};

firebase.initializeApp(firebaseConfig);
window.auth = typeof firebase.auth === 'function' ? firebase.auth() : null;
window.db = firebase.firestore();
