// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyByvgJzx0lu5GXiKmvVpJYqDwlgvt-nUrw",
  authDomain: "geo-sick-ai.firebaseapp.com",
  projectId: "geo-sick-ai",
  storageBucket: "geo-sick-ai.appspot.com",
  messagingSenderId: "747803827522",
  appId: "1:747803827522:web:1cbb4288b0c65f29e4bcdb",
  measurementId: "G-SEB3GZWX2P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);