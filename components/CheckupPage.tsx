import React, { useState } from 'react';
import { geocodeLocation, findFacilitiesByCoordinates } from '../services/geminiService';
import { HeartPulseIcon, BuildingOfficeIcon, UserIcon, SendIcon, DirectionsIcon, MagnifyingGlassIcon, CrosshairsIcon, CheckCircleIcon } from './icons';
import { LoadingSpinner } from './LoadingSpinner';
import type { Facility } from '../types';
import { BackButton } from './BackButton';

interface CheckupPageProps {
  onBack: () => void;
}

const getDistanceInKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Radius of the Earth in kilometers
    const rlat1 = lat1 * (Math.PI / 180);
    const rlat2 = lat2 * (Math.PI / 180);
    const difflat = rlat2 - rlat1;
    const difflon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(difflat / 2) * Math.sin(difflat / 2) +
        Math.cos(rlat1) * Math.cos(rlat2) *
        Math.sin(difflon / 2) * Math.sin(difflon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

type PaidFormStatus = 'idle' | 'sending' | 'sent';
type LocationStatus = 'idle' | 'fetching_gps' | 'geocoding' | 'finding_facilities' | 'success' | 'error';
type GeocodingStatus = 'idle' | 'loading' | 'success' | 'error';

export const CheckupPage: React.FC<CheckupPageProps> = ({ onBack }) => {
    const [facilities, setFacilities] = useState<Facility[]>([]);
    const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
    const [locationError, setLocationError] = useState<string | null>(null);
    const [searchCoords, setSearchCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [manualLocationInput, setManualLocationInput] = useState('');
    
    const [paidFormStatus, setPaidFormStatus] = useState<PaidFormStatus>('idle');
    const [formState, setFormState] = useState({ name: '', address: '', phone: '', date: '', email: '' });
    const [mapQuery, setMapQuery] = useState<string | null>(null);
    
    // State for address verification
    const [geocodingStatus, setGeocodingStatus] = useState<GeocodingStatus>('idle');
    const [geocodingError, setGeocodingError] = useState<string | null>(null);
    const [verifiedAddress, setVerifiedAddress] = useState<string | null>(null);


    const resetLocationState = () => {
        setFacilities([]);
        setLocationStatus('idle');
        setLocationError(null);
        setSearchCoords(null);
    };

    const findAndSetFacilities = async (coords: { lat: number, lng: number }) => {
        setLocationStatus('finding_facilities');
        setFacilities([]);
        setLocationError(null);
        try {
            const facilitiesFromApi = await findFacilitiesByCoordinates(coords);

            const nearbyFacilities = facilitiesFromApi
                .map(facility => ({
                    ...facility,
                    distance: getDistanceInKm(coords.lat, coords.lng, facility.lat, facility.lng)
                }))
                .sort((a, b) => a.distance - b.distance)
                .map(f => ({
                    ...f,
                    distance: `${f.distance.toFixed(1)} km`
                }));
            
            setFacilities(nearbyFacilities);
            setLocationStatus('success');
        } catch (error) {
            console.error("Facility finding error:", error);
            setLocationError("Could not find facilities. The AI model might be busy or unavailable.");
            setLocationStatus('error');
        }
    };
    
    const handleUseCurrentLocation = () => {
        resetLocationState();
        setLocationStatus('fetching_gps');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                const coords = { lat: latitude, lng: longitude };
                setSearchCoords(coords);
                findAndSetFacilities(coords);
            },
            (error) => {
                console.error("Geolocation error:", error.message);
                let errorMessage = "An unknown error occurred while trying to get your location.";
                switch (error.code) {
                    case 1: // PERMISSION_DENIED
                        errorMessage = "Location access was denied. Please check your browser and system settings. Ad-blockers or privacy extensions can also interfere with this feature.";
                        break;
                    case 2: // POSITION_UNAVAILABLE
                        errorMessage = "Location information is unavailable. This may be due to a poor network connection or being indoors. Please try again.";
                        break;
                    case 3: // TIMEOUT
                        errorMessage = "The request to get your location timed out. Please check your connection and try again.";
                        break;
                }
                setLocationError(errorMessage);
                setLocationStatus('error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    };

    const handleManualSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualLocationInput.trim()) return;
        resetLocationState();
        setLocationStatus('geocoding');
        try {
            const coords = await geocodeLocation(manualLocationInput);
            setSearchCoords(coords);
            await findAndSetFacilities(coords);
        } catch (error) {
            console.error("Geocoding error:", error);
            setLocationError("Could not find that location. Please try being more specific (e.g., 'Paris, France').");
            setLocationStatus('error');
        }
    };

    const handlePaidSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPaidFormStatus('sending');
        // Simulate API call
        setTimeout(() => {
            console.log('Appointment request submitted:', formState);
            setPaidFormStatus('sent');
        }, 1500);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        // If user changes address, reset verification
        if (name === 'address') {
            setGeocodingStatus('idle');
            setMapQuery(null);
            setVerifiedAddress(null);
            setGeocodingError(null);
        }
    };

    const handleVerifyAddress = async () => {
        if (!formState.address.trim()) {
            setGeocodingError("Please enter an address to verify.");
            setGeocodingStatus('error');
            return;
        }

        setGeocodingStatus('loading');
        setGeocodingError(null);
        setVerifiedAddress(null);
        setMapQuery(null);

        try {
            const { foundLocationName } = await geocodeLocation(formState.address);
            setVerifiedAddress(foundLocationName);
            setMapQuery(foundLocationName); // Use the verified name for the map query
            setGeocodingStatus('success');
        } catch (error) {
            console.error("Geocoding error:", error);
            setGeocodingError("Couldn't find this address. Please try being more specific (e.g., add a city and country).");
            setGeocodingStatus('error');
        }
    };

  return (
    <div className="w-full min-h-screen flex flex-col p-4 sm:p-6 lg:p-8 animate-fade-in bg-slate-50">
        <header className="w-full max-w-6xl mx-auto flex justify-start items-center">
            <BackButton onClick={onBack}>Back to Report</BackButton>
        </header>

        <main className="flex-grow flex flex-col items-center mt-8">
            <div className="text-center">
                <HeartPulseIcon className="w-16 h-16 mx-auto text-green-500" />
                <h1 className="text-4xl md:text-5xl font-bold text-slate-800 tracking-tight mt-4">Schedule a Checkup</h1>
                <p className="mt-3 max-w-2xl mx-auto text-lg text-slate-600">
                    Take the next step towards ensuring your health and safety. Choose an option below.
                </p>
            </div>

            <div className="w-full max-w-6xl mx-auto mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Free Checkup */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200/80 h-full flex flex-col">
                    <div className="flex items-center gap-3">
                        <BuildingOfficeIcon className="w-10 h-10 text-blue-500"/>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">Community Health Resources</h2>
                            <p className="text-slate-500 text-sm">Find nearby facilities worldwide</p>
                        </div>
                    </div>
                     <div className="mt-4 border-t border-slate-200 pt-4 space-y-4">
                        <form onSubmit={handleManualSearch} className="flex gap-2">
                             <input
                                type="text"
                                value={manualLocationInput}
                                onChange={(e) => setManualLocationInput(e.target.value)}
                                placeholder="Enter a City or Address"
                                className="flex-grow block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                disabled={locationStatus === 'geocoding' || locationStatus === 'finding_facilities'}
                            />
                            <button type="submit" className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center transition-all" disabled={!manualLocationInput || locationStatus === 'geocoding' || locationStatus === 'finding_facilities'}>
                               <MagnifyingGlassIcon className="w-5 h-5" />
                            </button>
                        </form>
                         <div className="flex items-center gap-2">
                            <hr className="flex-grow border-slate-200" />
                            <span className="text-xs font-semibold text-slate-400">OR</span>
                            <hr className="flex-grow border-slate-200" />
                        </div>
                        <button onClick={handleUseCurrentLocation} disabled={locationStatus === 'fetching_gps' || locationStatus === 'finding_facilities'} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-lg flex items-center justify-center transition-all disabled:opacity-70">
                           <CrosshairsIcon className="w-5 h-5 mr-2" /> Use My Current Location
                        </button>
                    </div>

                    <div className="mt-6 flex-grow">
                        {locationStatus === 'fetching_gps' && <div className="flex items-center justify-center text-slate-600"><LoadingSpinner /><span className="ml-3">Getting your location...</span></div>}
                        {locationStatus === 'geocoding' && <div className="flex items-center justify-center text-slate-600"><LoadingSpinner /><span className="ml-3">Finding location...</span></div>}
                        {locationStatus === 'finding_facilities' && <div className="flex items-center justify-center text-slate-600"><LoadingSpinner /><span className="ml-3">Finding nearby facilities...</span></div>}

                        {locationStatus === 'error' && (
                            <div className="text-center p-3 bg-red-50 rounded-md">
                                <p className="text-sm text-red-600">{locationError}</p>
                            </div>
                        )}
                        
                        {locationStatus === 'success' && (
                            facilities.length > 0 ? (
                                <div className="space-y-3 animate-fade-in">
                                    <h3 className="font-semibold text-slate-700">Nearest Facilities Found ({facilities.length}):</h3>
                                    <ul className="divide-y divide-slate-200 border rounded-md max-h-64 overflow-y-auto">
                                        {facilities.map((facility, index) => {
                                            const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${facility.lat},${facility.lng}`;
                                            return (
                                            <li key={index} className="p-3 flex justify-between items-center bg-white">
                                                <div>
                                                    <p className="font-medium text-slate-800">{facility.name}</p>
                                                    <p className="text-sm text-slate-500">{facility.type} - {facility.distance}</p>
                                                </div>
                                                <a 
                                                    href={directionsUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold py-2 px-3 rounded-full flex items-center justify-center text-sm transition-colors"
                                                    aria-label={`Get directions to ${facility.name}`}
                                                >
                                                    <DirectionsIcon className="w-4 h-4 mr-1.5" />
                                                    Directions
                                                </a>
                                            </li>
                                        )})}
                                    </ul>
                                </div>
                            ) : (
                                <div className="p-4 mt-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 animate-fade-in text-center" role="alert">
                                    <p className="font-bold">No Facilities Found</p>
                                    <p className="text-sm">Our AI couldn't find any health facilities within a 5km radius.</p>
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Paid Checkup */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200/80 h-full flex flex-col">
                    <div className="flex items-center gap-3">
                        <UserIcon className="w-10 h-10 text-green-500"/>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">Personalized In-Person Visit</h2>
                            <p className="text-slate-500 text-sm">Paid consultation</p>
                        </div>
                    </div>
                    {paidFormStatus === 'sent' ? (
                        <div className="flex-grow flex flex-col items-center justify-center text-center p-6 sm:p-8 bg-green-50 rounded-lg mt-4 animate-fade-in border-t-4 border-green-400">
                            <CheckCircleIcon className="w-16 h-16 text-green-500" />
                            <h3 className="text-2xl font-bold text-green-800 mt-4">Appointment Requested!</h3>
                            <p className="text-green-700 mt-2 max-w-md">
                                Your request has been successfully submitted. We will send a confirmation email to <strong>{formState.email}</strong> shortly.
                            </p>
                            <div className="mt-6 text-left w-full max-w-sm bg-white p-4 rounded-lg border border-green-200">
                                <p className="text-sm font-semibold text-slate-700">Booking Summary:</p>
                                <ul className="text-sm text-slate-600 mt-2 space-y-1">
                                    <li><strong>Name:</strong> {formState.name}</li>
                                    <li><strong>Date:</strong> {formState.date}</li>
                                    <li><strong>Location:</strong> {verifiedAddress || formState.address}</li>
                                </ul>
                            </div>
                            <button 
                                onClick={() => {
                                    setPaidFormStatus('idle');
                                    setFormState({ name: '', address: '', phone: '', date: '', email: '' });
                                    setMapQuery(null);
                                    setGeocodingStatus('idle');
                                    setVerifiedAddress(null);
                                }} 
                                className="mt-6 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-full transition-transform transform hover:scale-105"
                            >
                                Schedule Another
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handlePaidSubmit} className="mt-4 border-t border-slate-200 pt-4 space-y-4">
                            <p className="text-sm text-slate-600">Fill out the form to request a health professional visit. We'll confirm your appointment via email.</p>
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full Name</label>
                                <input type="text" name="name" id="name" required value={formState.name} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500" placeholder="Your Full Name"/>
                            </div>
                             <div>
                                <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email for Confirmation</label>
                                <input type="email" name="email" id="email" required value={formState.email} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500" placeholder="you@example.com"/>
                            </div>
                            <div>
                                <label htmlFor="address" className="block text-sm font-medium text-slate-700">Full Address</label>
                                <div className="relative mt-1">
                                    <textarea name="address" id="address" rows={2} required value={formState.address} onChange={handleInputChange} className="block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 pr-12" placeholder="123 Main St, Anytown, USA"></textarea>
                                    <button 
                                        type="button" 
                                        onClick={handleVerifyAddress} 
                                        disabled={geocodingStatus === 'loading' || !formState.address.trim()}
                                        className="absolute top-1/2 right-2 -translate-y-1/2 p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed" 
                                        aria-label="Verify Address on Map"
                                    >
                                        {geocodingStatus === 'loading' 
                                            ? <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div> 
                                            : <MagnifyingGlassIcon className="w-5 h-5" />}
                                    </button>
                                </div>
                                {geocodingStatus === 'error' && <p className="text-red-600 text-sm mt-1">{geocodingError}</p>}
                            </div>

                            {geocodingStatus === 'loading' && (
                                <div className="flex items-center justify-center h-[200px] mt-2 bg-slate-50 rounded-md border">
                                    <LoadingSpinner />
                                    <span className="ml-3 text-slate-600">Verifying address...</span>
                                </div>
                            )}

                            {geocodingStatus === 'success' && mapQuery && (
                                <div className="mt-4 animate-fade-in">
                                    <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                        <CheckCircleIcon className="w-5 h-5 text-green-500"/>
                                        Verified Location
                                    </p>
                                    <p className="text-xs text-slate-500 mb-2 pl-7">{verifiedAddress}</p>
                                    <div className="rounded-md overflow-hidden border border-slate-300">
                                        <iframe
                                            width="100%"
                                            height="200"
                                            style={{ border: 0 }}
                                            loading="lazy"
                                            allowFullScreen
                                            referrerPolicy="no-referrer-when-downgrade"
                                            src={`https://www.google.com/maps/embed/v1/place?key=${process.env.API_KEY}&q=${encodeURIComponent(mapQuery)}`}
                                        ></iframe>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="phone" className="block text-sm font-medium text-slate-700">Phone Number</label>
                                    <input type="tel" name="phone" id="phone" required value={formState.phone} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500" placeholder="Your Contact Phone Number"/>
                                </div>
                                <div>
                                    <label htmlFor="date" className="block text-sm font-medium text-slate-700">Preferred Date</label>
                                    <input type="date" name="date" id="date" required value={formState.date} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"/>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={paidFormStatus === 'sending' || geocodingStatus !== 'success'}
                                className="w-full mt-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-all duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed"
                            >
                                <SendIcon className="w-5 h-5 mr-2" />
                                {paidFormStatus === 'sending' ? 'Submitting Request...' : 'Request Visit'}
                            </button>
                             {geocodingStatus !== 'success' && <p className="text-center text-xs text-slate-500 mt-2">Please verify your address before requesting a visit.</p>}
                        </form>
                    )}
                </div>
            </div>
        </main>
    </div>
  );
};
