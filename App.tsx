import React, { useState, useEffect } from 'react';
import { HomePage } from './components/HomePage';
import { WelcomePage } from './components/WelcomePage';
import { GlobePage } from './components/GlobePage';
import { AboutPage } from './components/AboutPage';
import { ContactPage } from './components/ContactPage';
import { ChatBot } from './components/ChatBot';
import { ImageAnalysisPage } from './components/ImageAnalysisPage';
import { CheckupPage } from './components/CheckupPage';
import { PrescriptionAnalysisPage } from './components/PrescriptionAnalysisPage';
import { IntroAnimation } from './components/IntroAnimation';
import { MentalHealthPage } from './components/MentalHealthPage';
import { SymptomCheckerPage } from './components/SymptomCheckerPage';
import { AuthPage } from './components/AuthPage';
import { ActivityHistoryPage } from './components/ActivityHistoryPage';
import type { User, ActivityLogItem, Page } from './types';
import { HealthForecast } from './components/HealthForecast';
import { AdminDashboardPage } from './components/AdminDashboardPage';
import { ProfilePage } from './components/ProfilePage';
import { Sidebar } from './components/Sidebar';
import { AlertsPage } from './components/AlertsPage';
import { WaterLogPage } from './components/WaterLogPage';
import { Bars3Icon, GlobeIcon } from './components/icons';
import { FeedbackModal } from './components/FeedbackModal';
import { I18nProvider } from './components/I18n';

const ACTIVITY_HISTORY_KEY = 'geosick_activity_history';
const GLOBAL_ACTIVITY_HISTORY_KEY = 'geosick_global_activity_history';
const USERS_KEY = 'geosick_users';
const SESSION_KEY = 'geosick_session_phone';

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [showIntro, setShowIntro] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [activityHistory, setActivityHistory] = useState<ActivityLogItem[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  useEffect(() => {
    // Ensure admin user exists on first load
    try {
        const allUsers: User[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const adminEmail = 'nookanikshithllpsdsnr@gmail.com';
        const adminExists = allUsers.some(u => u.email === adminEmail);

        if (!adminExists) {
            const adminUser: User = {
                name: 'Admin',
                phone: '0000000000',
                email: adminEmail,
                password: 'nooka@nikki123',
                date_of_birth: '2000-01-01',
                created_at: new Date().toISOString(),
                isAdmin: true,
            };
            allUsers.push(adminUser);
            localStorage.setItem(USERS_KEY, JSON.stringify(allUsers));
            console.log("Admin user created.");
        }
    } catch (error) {
        console.error("Failed to create admin user:", error);
    }

    // Check for a logged-in user in localStorage
    const checkSession = () => {
        try {
            const loggedInUserPhone = localStorage.getItem(SESSION_KEY);
            if (loggedInUserPhone) {
                const allUsers: any[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
                const currentUser = allUsers.find(u => u.phone === loggedInUserPhone);
                if (currentUser) {
                    const { password, ...userDetails } = currentUser;
                    setUser(userDetails);
                    setCurrentPage('welcome');
                } else {
                    localStorage.removeItem(SESSION_KEY);
                }
            }
        } catch (error) {
            console.error("Session validation failed:", error);
            localStorage.removeItem(SESSION_KEY);
        }
    };
    checkSession();
      
    // Load personal activity history
    try {
      const storedHistory = localStorage.getItem(ACTIVITY_HISTORY_KEY);
      if (storedHistory) {
          setActivityHistory(JSON.parse(storedHistory));
      }
    } catch (error) {
        console.error("Could not load activity history from localStorage:", error);
        localStorage.removeItem(ACTIVITY_HISTORY_KEY);
    }
  }, []);

  const addGlobalActivityToHistory = (item: ActivityLogItem) => {
      try {
          const globalHistory: ActivityLogItem[] = JSON.parse(localStorage.getItem(GLOBAL_ACTIVITY_HISTORY_KEY) || '[]');
          const newGlobalHistory = [item, ...globalHistory];
          localStorage.setItem(GLOBAL_ACTIVITY_HISTORY_KEY, JSON.stringify(newGlobalHistory));
      } catch (error) {
           console.error("Could not save global activity to localStorage:", error);
      }
  };

  const addActivityToHistory = (item: Omit<ActivityLogItem, 'id' | 'timestamp' | 'userPhone'>) => {
      if (!user) return;
      const newActivity: ActivityLogItem = {
          ...item,
          id: new Date().toISOString() + Math.random(),
          timestamp: Date.now(),
          userPhone: user.phone,
      };

      setActivityHistory(prevHistory => {
          const newHistory = [newActivity, ...prevHistory];
          try {
            localStorage.setItem(ACTIVITY_HISTORY_KEY, JSON.stringify(newHistory));
          } catch (error) {
              console.error("Could not save activity history to localStorage:", error);
          }
          return newHistory;
      });

      addGlobalActivityToHistory(newActivity);
  };
  
  const handleUpdateUser = (updatedDetails: Partial<User>) => {
    if (!user) return false;
    
    try {
        const allUsers: any[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const userIndex = allUsers.findIndex(u => u.phone === user.phone);

        if (userIndex !== -1) {
            const updatedUser = { ...allUsers[userIndex], ...updatedDetails };
            allUsers[userIndex] = updatedUser;
            localStorage.setItem(USERS_KEY, JSON.stringify(allUsers));
            
            const { password, ...userDetails } = updatedUser;
            setUser(userDetails);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Failed to update user:", error);
        return false;
    }
  };


  const handleAuthSuccess = (authedUser: User) => {
    // Update last_login_at for the user who just logged in.
    let userWithTimestamp = { ...authedUser };
    try {
        const allUsers: User[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const userIndex = allUsers.findIndex(u => u.phone === authedUser.phone);
        
        if (userIndex !== -1) {
            const now = new Date().toISOString();
            allUsers[userIndex].last_login_at = now;
            localStorage.setItem(USERS_KEY, JSON.stringify(allUsers));
            userWithTimestamp.last_login_at = now; // Ensure state has latest login time
        }
    } catch (error) {
        console.error("Failed to update last login time:", error);
    }
    
    const { password, ...userDetails } = userWithTimestamp;
    setUser(userDetails);
    setShowAuth(false);
    setCurrentPage('welcome');
    localStorage.setItem(SESSION_KEY, userWithTimestamp.phone);

    addGlobalActivityToHistory({
        id: new Date().toISOString(),
        timestamp: Date.now(),
        userPhone: userWithTimestamp.phone,
        type: 'login',
        title: 'User Logged In',
        data: { message: `User ${userWithTimestamp.name} (${userWithTimestamp.phone}) logged in.` },
    });
  };
  
  const handleLogout = () => {
      setUser(null);
      setCurrentPage('home');
      localStorage.removeItem(SESSION_KEY);
      setIsFeedbackModalOpen(false);
  };

  const handleNavigation = (page: Page) => {
      setCurrentPage(page);
  };
  
  const renderPublicPages = () => {
    switch (currentPage) {
        case 'about':
            return <AboutPage onBack={() => setCurrentPage('home')} />;
        case 'contact':
            return <ContactPage onBack={() => setCurrentPage('home')} />;
        case 'explore':
             return <GlobePage onBack={() => setCurrentPage('home')} />;
        case 'home':
        default:
            return <HomePage
                onLoginClick={() => setShowAuth(true)}
                onAboutClick={() => setCurrentPage('about')}
                onContactClick={() => setCurrentPage('contact')}
                onExploreClick={() => setCurrentPage('explore')}
            />;
    }
  }

  const renderAuthenticatedApp = () => {
    if (!user) return null;

    const renderPage = () => {
        const isAdmin = !!user.isAdmin;
        switch (currentPage) {
            case 'welcome':
            case 'home': // Redirect home to welcome if logged in
                return <WelcomePage
                    user={user}
                    onAnalyze={() => setCurrentPage('image-analysis')}
                    onAnalyzePrescription={() => setCurrentPage('prescription-analysis')}
                    onAnalyzeMentalHealth={() => setCurrentPage('mental-health')}
                    onCheckSymptoms={() => setCurrentPage('symptom-checker')}
                    onWaterLog={() => setCurrentPage('water-log')}
                />;
            case 'live-alerts':
                return <AlertsPage />;
            case 'image-analysis':
                return <ImageAnalysisPage
                    onBack={() => setCurrentPage('welcome')}
                    onScheduleCheckup={() => setCurrentPage('checkup')}
                    onAnalysisComplete={addActivityToHistory}
                />;
            case 'prescription-analysis':
                return <PrescriptionAnalysisPage onBack={() => setCurrentPage('welcome')} onAnalysisComplete={addActivityToHistory} />;
            case 'checkup':
                return <CheckupPage onBack={() => setCurrentPage('image-analysis')} />;
            case 'mental-health':
                return <MentalHealthPage onBack={() => setCurrentPage('welcome')} onAnalysisComplete={addActivityToHistory} />;
            case 'symptom-checker':
                return <SymptomCheckerPage onBack={() => setCurrentPage('welcome')} onAnalysisComplete={addActivityToHistory} />;
            case 'health-briefing': 
                 return <HealthForecast onBack={() => setCurrentPage('welcome')} />;
            case 'activity-history':
                 return <ActivityHistoryPage history={activityHistory} onBack={() => setCurrentPage('welcome')} />;
            case 'profile':
                return <ProfilePage user={user} onBack={() => setCurrentPage('welcome')} onUpdateUser={handleUpdateUser} />;
            case 'water-log':
                return <WaterLogPage onBack={() => setCurrentPage('welcome')} />;
            case 'admin-dashboard':
                return isAdmin ? <AdminDashboardPage onBack={() => setCurrentPage('welcome')} /> : <p>Access Denied. You do not have permission to view this page.</p>;
            case 'about':
                 return <AboutPage onBack={() => setCurrentPage('welcome')} />;
            case 'contact':
                return <ContactPage onBack={() => setCurrentPage('welcome')} />;
            case 'explore':
                return <GlobePage onBack={() => setCurrentPage('welcome')} />;
            default:
                return <WelcomePage
                    user={user}
                    onAnalyze={() => setCurrentPage('image-analysis')}
                    onAnalyzePrescription={() => setCurrentPage('prescription-analysis')}
                    onAnalyzeMentalHealth={() => setCurrentPage('mental-health')}
                    onCheckSymptoms={() => setCurrentPage('symptom-checker')}
                    onWaterLog={() => setCurrentPage('water-log')}
                />;
        }
    };
    
    return (
        <div className="flex h-screen bg-slate-100">
            <Sidebar 
                user={user} 
                currentPage={currentPage} 
                onNavigate={(page: Page) => {
                    handleNavigation(page);
                    setIsSidebarOpen(false);
                }} 
                onLogout={handleLogout}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onOpenFeedbackModal={() => setIsFeedbackModalOpen(true)}
            />
             <div className="flex-1 flex flex-col">
                <header className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between shadow-sm relative z-20">
                    <button onClick={() => setIsSidebarOpen(true)} className="text-slate-600 p-1" aria-label="Open menu">
                        <Bars3Icon className="w-6 h-6" />
                    </button>
                    <div className="flex items-center gap-2">
                        <GlobeIcon className="w-7 h-7 text-blue-500" />
                        <h1 className="text-lg font-bold tracking-tight text-slate-800">GeoSick</h1>
                    </div>
                    <div className="w-7"></div>
                </header>
                <main className="flex-1 overflow-y-auto">
                    {renderPage()}
                </main>
            </div>
        </div>
    );
  };

  if (showIntro) {
    return <IntroAnimation onComplete={() => setShowIntro(false)} />;
  }

  return (
    <>
      {user ? renderAuthenticatedApp() : renderPublicPages()}
      {user && <ChatBot onNavigate={handleNavigation} />}
      {user && isFeedbackModalOpen && (
        <FeedbackModal 
            user={user}
            onClose={() => setIsFeedbackModalOpen(false)} 
        />
      )}
      {showAuth && (
        <AuthPage
          onClose={() => setShowAuth(false)}
          onAuthSuccess={handleAuthSuccess}
        />
      )}
    </>
  );
}

export default function App() {
    return (
        <I18nProvider>
            <AppContent />
        </I18nProvider>
    );
}