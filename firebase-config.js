// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyB8qL4JGzV6KZjNhGqI_jVhVrh3XyZ5K4w",
  authDomain: "primabilvard-6c99e.firebaseapp.com",
  projectId: "primabilvard-6c99e",
  storageBucket: "primabilvard-6c99e.appspot.com",
  messagingSenderId: "574698393227",
  appId: "1:574698393227:web:8a5f6c1e2b9d4e3f1a2b3c"
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/latest/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/latest/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
window.db = getFirestore(app);
