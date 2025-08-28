import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

// --- Firebase Configuration ---
// Reads the configuration from the secure .env.local file
const firebaseConfig = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_APP_ID,
  measurementId: process.env.REACT_APP_MEASUREMENT_ID
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Gemini API Configuration ---
// Reads the API key from the secure .env.local file
const API_KEY = process.env.REACT_APP_GEMINI_API_KEY; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [userRoadmaps, setUserRoadmaps] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        signInAnonymously(auth).catch(err => {
          console.error("Anonymous sign-in failed:", err);
          setError("Authentication failed. Please try again later.");
        });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "roadmaps"), where("userId", "==", user.uid));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const roadmapsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      roadmapsData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setUserRoadmaps(roadmapsData);
    }, (err) => {
      console.error("Error fetching roadmaps:", err);
      setError("Could not fetch your saved roadmaps.");
    });
    return () => unsubscribe();
  }, [user]);

  const generateRoadmap = async () => {
    if (!topic.trim()) {
      setError('Please enter a topic to begin.');
      return;
    }
    setGenerating(true);
    setError('');
    const systemPrompt = `
      You are an expert learning guide called "PathFinder Pro". 
      Your task is to generate a concise, structured, and practical learning roadmap for any given topic.
      The roadmap should consist of 4-6 sequential modules.
      Each module must have a clear title and two distinct, actionable online resources (like articles, videos, or official documentation).
      Provide a name for each resource and a valid, direct URL. Do not use placeholder URLs.
      Ensure the entire response is in the specified JSON format.
    `;
    const payload = {
      contents: [{ parts: [{ text: `Generate a learning roadmap for: ${topic}` }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            modules: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  resources: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        url: { type: "STRING" }
                      },
                      required: ["name", "url"]
                    }
                  }
                },
                required: ["title", "resources"]
              }
            }
          },
          required: ["title", "modules"]
        }
      }
    };
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`API error: ${response.statusText}`);
      const result = await response.json();
      const jsonText = result.candidates[0].content.parts[0].text;
      const parsedRoadmap = JSON.parse(jsonText);
      const finalRoadmap = {
        ...parsedRoadmap,
        title: `Learning Roadmap for ${topic}`,
        userId: user.uid,
        createdAt: serverTimestamp(),
        modules: parsedRoadmap.modules.map(m => ({ ...m, completed: false }))
      };
      await addDoc(collection(db, "roadmaps"), finalRoadmap);
      setTopic('');
    } catch (err) {
      console.error("Roadmap generation failed:", err);
      setError('Failed to generate roadmap from AI. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const toggleModuleCompletion = async (roadmapId, moduleIndex) => {
    const roadmapToUpdate = userRoadmaps.find(r => r.id === roadmapId);
    if (!roadmapToUpdate) return;
    const updatedModules = [...roadmapToUpdate.modules];
    updatedModules[moduleIndex].completed = !updatedModules[moduleIndex].completed;
    const roadmapRef = doc(db, "roadmaps", roadmapId);
    try {
      await updateDoc(roadmapRef, { modules: updatedModules });
    } catch (err) {
      console.error("Failed to update module status:", err);
      setError("Couldn't update progress. Please check your connection.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-2xl font-semibold">Loading PathFinder Pro...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white font-sans p-4 sm-p-6 lg:p-8 bg-gradient-to-br from-gray-900 via-blue-900/50 to-purple-900/50">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-10">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            PathFinder Pro
          </h1>
          {user && <p className="text-sm text-gray-400 bg-black/20 px-3 py-1 rounded-full">User ID: {user.uid.substring(0, 6)}</p>}
        </header>

        <div className="bg-black/20 backdrop-blur-lg border border-white/10 p-6 rounded-2xl shadow-2xl mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-gray-200">Generate a New Learning Roadmap</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic (e.g., 'React', 'Quantum Physics')"
              className="flex-grow p-3 bg-gray-900/50 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-purple-500 transition placeholder-gray-500"
              disabled={generating}
            />
            <button
              onClick={generateRoadmap}
              disabled={generating || !topic.trim()}
              className="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 px-8 rounded-lg hover:opacity-90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-purple-500/50"
            >
              {generating ? 'Generating...' : 'Create Path'}
            </button>
          </div>
          {error && <p className="text-red-400 mt-4">{error}</p>}
        </div>

        <div className="mt-12">
          <h2 className="text-3xl font-bold mb-6 text-gray-300">Your Roadmaps</h2>
          {userRoadmaps.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {userRoadmaps.map((r, index) => (
                <RoadmapCard key={r.id} roadmap={r} onToggleModule={toggleModuleCompletion} index={index} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-black/20 backdrop-blur-lg border border-white/10 rounded-2xl">
              <p className="text-gray-400 text-lg">Your learning paths will appear here.</p>
              <p className="text-gray-500 mt-2">Use the generator above to create your first roadmap!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Roadmap Card Component ---
function RoadmapCard({ roadmap, onToggleModule, index }) {
  const progress = roadmap.modules.length > 0 ? Math.round(
    (roadmap.modules.filter(m => m.completed).length / roadmap.modules.length) * 100
  ) : 0;

  return (
    <div 
      className="bg-black/20 backdrop-blur-lg border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col h-full transition-all duration-500 opacity-0 animate-fade-in"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <h3 className="text-xl font-bold mb-2 text-purple-300">{roadmap.title}</h3>
      {roadmap.createdAt?.seconds && (
        <p className="text-xs text-gray-500 mb-4">
          Created: {new Date(roadmap.createdAt.seconds * 1000).toLocaleDateString()}
        </p>
      )}
      <div className="w-full bg-black/30 rounded-full h-2.5 mb-1">
        <div
          className="bg-gradient-to-r from-green-400 to-blue-500 h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <p className="text-sm font-medium text-gray-300 mb-4 text-right">{progress}% Complete</p>
      <div className="space-y-3 flex-grow overflow-y-auto pr-2" style={{maxHeight: '300px'}}>
        {roadmap.modules.map((module, index) => (
          <ModuleItem
            key={index}
            module={module}
            onToggle={() => onToggleModule(roadmap.id, index)}
          />
        ))}
      </div>
    </div>
  );
}

// --- Module Item Component ---
function ModuleItem({ module, onToggle }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`rounded-lg transition-colors duration-300 ${module.completed ? 'bg-green-800/20' : 'bg-gray-900/40'}`}>
      <div
        onClick={onToggle}
        className="p-3 flex items-center cursor-pointer hover:bg-gray-700/50 rounded-t-lg transition-colors"
      >
        <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 border-2 flex-shrink-0 transition-all duration-300 ${module.completed ? 'bg-green-500 border-green-400' : 'border-gray-500'}`}>
          {module.completed && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <span className={`flex-grow ${module.completed ? 'line-through text-gray-400' : ''}`}>{module.title}</span>
        {module.resources?.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="ml-2 p-1 rounded-full hover:bg-gray-500/50"
          >
            <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      {isExpanded && module.resources && (
        <div className="pl-10 pr-4 pb-3 pt-2 border-t border-white/10">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Resources:</h4>
            <ul className="list-disc list-inside space-y-1">
                {module.resources.map((res, i) => (
                    <li key={i}>
                        <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm">
                            {res.name}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
      )}
    </div>
  );
}