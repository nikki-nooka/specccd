import { GoogleGenAI, Type, GenerateContentResponse, GenerateImagesResponse } from "@google/genai";
import type { AnalysisResult, LocationAnalysisResult, Facility, PrescriptionAnalysisResult, HealthForecast, MentalHealthResult, SymptomAnalysisResult, Page, BotCommandResponse, Alert, AlertSource, CityHealthSnapshot, AlertCategory } from '../types';
import * as cache from './cacheService';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A wrapper function for Gemini API calls that implements a retry mechanism
 * with exponential backoff for rate-limiting errors (429).
 * @param apiCall The async function that makes the API call.
 * @param maxRetries The maximum number of times to retry the call.
 * @param initialDelay The initial delay in milliseconds before the first retry.
 * @returns The result of the API call.
 */
async function callGeminiWithRetry<T>(
    apiCall: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await apiCall();
        } catch (error: any) {
            const isRateLimitError = error.toString().includes('429') || error.toString().includes('RESOURCE_EXHAUSTED');

            if (isRateLimitError && attempt < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, attempt);
                console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                attempt++;
            } else {
                console.error("API call failed after multiple retries or with a non-retriable error.", error);
                throw error; // Re-throw the error if it's not a rate limit error or retries are exhausted
            }
        }
    }
    // This line should not be reachable, but is here to satisfy TypeScript
    throw new Error('Exceeded maximum retries for Gemini API call.');
}


const locationAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        locationName: { type: Type.STRING, description: "The short name of the identified location (e.g., 'Central Park, New York, USA')." },
        hazards: {
            type: Type.ARRAY,
            description: "A list of identified potential health hazards based on the location's geography and climate.",
            items: {
                type: Type.OBJECT,
                properties: {
                    hazard: { type: Type.STRING, description: "The specific hazard identified, e.g., 'Stagnant Water Pool'." },
                    description: { type: Type.STRING, description: "A brief description of why this hazard is relevant to the location." }
                },
                required: ["hazard", "description"]
            }
        },
        diseases: {
            type: Type.ARRAY,
            description: "A list of potential diseases associated with the identified hazards.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of the potential disease, e.g., 'Malaria'." },
                    cause: { type: Type.STRING, description: "How the identified hazards can cause this disease." },
                    precautions: {
                        type: Type.ARRAY,
                        description: "A list of practical preventive measures against this disease.",
                        items: { type: Type.STRING }
                    }
                },
                required: ["name", "cause", "precautions"]
            }
        },
        summary: {
            type: Type.STRING,
            description: "A concise overall summary of the environmental health assessment, written in an urgent but informative tone."
        }
    },
    required: ["locationName", "hazards", "diseases", "summary"]
};

export const analyzeLocationByCoordinates = async (lat: number, lng: number, language: string, knownLocationName?: string): Promise<{ analysis: LocationAnalysisResult, imageUrl: string | null }> => {
    const cacheKey = `location_${lat.toFixed(4)}_${lng.toFixed(4)}_${language}_${knownLocationName || ''}`;
    const cached = cache.get<{ analysis: LocationAnalysisResult, imageUrl: string | null }>(cacheKey);
    if (cached) {
        return cached;
    }

    let contents: string;
    const languageInstruction = `Your response must be a single JSON object conforming to the provided schema. All text content within the JSON must be in ${language}. Your analysis must be distinct and tailored, avoiding repetition for nearby coordinates.`;
    
    if (knownLocationName) {
        contents = `Act as a specialized environmental scientist. Your task is to provide a highly specific and unique analysis for the *exact* location known as "${knownLocationName}" at coordinates: latitude ${lat}, longitude ${lng}. Do not provide a generic regional summary; focus on the distinct micro-environment of this point.
            Your goal is to identify potential environmental health risks based on its specific geography and climate, not to provide medical advice.
            1. Use the exact name "${knownLocationName}" for the 'locationName' field.
            2. Based on its *specific* environment (e.g., proximity to water, elevation, urban density), list potential health hazards.
            3. For each hazard, list associated, potential diseases or health conditions.
            4. For each disease, list general, non-prescriptive public health precautions.
            5. Write a brief, neutral summary of this specific location's environmental profile.
            ${languageInstruction}`;
    } else {
        contents = `Act as a specialized environmental scientist. Your task is to provide a highly specific and unique analysis for the *exact* coordinates: latitude ${lat}, longitude ${lng}. Do not provide a generic regional summary; focus on the distinct micro-environment of this point.
            Your goal is to identify potential environmental health risks based on its specific geography and climate, not to provide medical advice.
            1. Identify the common name for this specific location (e.g., 'Central Park, New York, USA').
            2. Based on its *specific* environment (e.g., proximity to water, elevation, urban density), list potential health hazards.
            3. For each hazard, list associated, potential diseases or health conditions.
            4. For each disease, list general, non-prescriptive public health precautions.
            5. Write a brief, neutral summary of this specific location's environmental profile.
            ${languageInstruction}`;
    }

    const [analysisResult, imageResult] = await Promise.allSettled([
        callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: locationAnalysisSchema,
            }
        })),
        callGeminiWithRetry<GenerateImagesResponse>(() => ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: `Generate a highly realistic and detailed satellite-style photograph of the specific location at latitude ${lat}, longitude ${lng}. The image should accurately reflect the plausible geography, biome (e.g., forest, desert, coastal, urban), and population density for this exact point on Earth. Capture the unique environmental characteristics. Do not include any text, borders, or UI elements. The style should be photorealistic.`,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/jpeg',
              aspectRatio: '16:9',
            },
        }))
    ]);

    if (analysisResult.status === 'rejected') {
        console.error("Location analysis failed:", analysisResult.reason);
        throw new Error("The model failed to provide location analysis.");
    }

    let analysis: LocationAnalysisResult;
    try {
        const jsonText = analysisResult.value.text.trim();
        analysis = JSON.parse(jsonText) as LocationAnalysisResult;
    } catch (e) {
        console.error("Failed to parse JSON from analysis:", analysisResult.value.text);
        throw new Error("The model returned an invalid data format for the location analysis.");
    }
    
    let imageUrl: string | null = null;
    if (imageResult.status === 'fulfilled') {
        const imageResponse = imageResult.value;
        if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
            const base64ImageBytes = imageResponse.generatedImages[0].image.imageBytes;
            imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
        } else {
             console.warn("Image generation succeeded but returned no images.");
        }
    } else {
        console.warn("Image generation failed:", imageResult.reason);
    }
    
    const result = { analysis, imageUrl };
    cache.set(cacheKey, result, 10);
    return result;
};

const analysisSchema = {
    type: Type.OBJECT,
    properties: {
        hazards: {
            type: Type.ARRAY,
            description: "A list of identified potential health hazards in the image.",
            items: {
                type: Type.OBJECT,
                properties: {
                    hazard: { type: Type.STRING, description: "The specific hazard identified, e.g., 'Stagnant Water Pool'." },
                    description: { type: Type.STRING, description: "A brief description of the hazard and its location in the image." }
                },
                required: ["hazard", "description"]
            }
        },
        diseases: {
            type: Type.ARRAY,
            description: "A list of potential diseases associated with the identified hazards.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of the potential disease, e.g., 'Malaria'." },
                    cause: { type: Type.STRING, description: "How the identified hazards can cause this disease." },
                    precautions: {
                        type: Type.ARRAY,
                        description: "A list of practical preventive measures against this disease.",
                        items: { type: Type.STRING }
                    }
                },
                required: ["name", "cause", "precautions"]
            }
        },
        summary: {
            type: Type.STRING,
            description: "A concise overall summary of the environmental health assessment, written in an urgent but informative tone."
        }
    },
    required: ["hazards", "diseases", "summary"]
};

export const analyzeImage = async (base64ImageData: string, language: string): Promise<AnalysisResult> => {
    const imagePart = {
        inlineData: {
            mimeType: 'image/jpeg',
            data: base64ImageData,
        },
    };

    const textPart = {
        text: `You are an expert environmental health and public safety analyst named GeoSick. Analyze the provided image of a geographical area.
        1.  **Identify Potential Health Hazards:** Pinpoint any visible issues such as stagnant water, garbage piles, pollution, pests, or poor sanitation. Be specific.
        2.  **Predict Associated Diseases:** Based on the identified hazards, list potential diseases (e.g., Malaria from stagnant water, Cholera from contaminated water sources, respiratory issues from air pollution).
        3.  **Provide a Detailed Report:** Synthesize your findings into a clear, structured report.
        4.  **Suggest Actionable Precautions:** For each potential disease, provide a list of practical and effective preventive measures for individuals and the community.
        Your response must be in JSON format conforming to the provided schema. All text values within the JSON must be in ${language}.`
    };

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: analysisSchema
        }
    }));

    try {
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as AnalysisResult;
    } catch (e) {
        console.error("Failed to parse JSON response:", response.text);
        throw new Error("The model returned an invalid data format.");
    }
};

const prescriptionAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.STRING,
            description: "A concise summary of the prescription's purpose in simple, easy-to-understand language. Start with 'This prescription is for...'."
        },
        medicines: {
            type: Type.ARRAY,
            description: "A list of all prescribed medicines found in the image.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The name of the medicine." },
                    dosage: { type: Type.STRING, description: "The dosage and frequency instructions (e.g., '500mg, twice a day for 7 days')." }
                },
                required: ["name", "dosage"]
            }
        },
        precautions: {
            type: Type.ARRAY,
            description: "A list of important precautions or advice mentioned in the prescription (e.g., 'Take with food', 'Avoid driving').",
            items: { type: Type.STRING }
        }
    },
    required: ["summary", "medicines", "precautions"]
};


export const analyzePrescription = async (base64ImageData: string, language: string): Promise<PrescriptionAnalysisResult> => {
    const imagePart = {
        inlineData: {
            mimeType: 'image/jpeg',
            data: base64ImageData,
        },
    };

    const textPart = {
        text: `You are an expert medical transcriptionist. Analyze the provided image of a doctor's prescription, which may be handwritten or typed.
        1.  **Interpret the content:** Carefully read all text on the prescription.
        2.  **Extract Key Information:** Identify all prescribed medicines and their exact dosages/instructions.
        3.  **Identify Precautions:** Note any special warnings, advice, or precautions mentioned.
        4.  **Summarize:** Provide a brief, simple summary of the prescription's purpose.
        If any part of the prescription is illegible, state that clearly in the relevant field (e.g., 'Dosage illegible'). Do not guess.
        Your response must be in JSON format conforming to the provided schema. All text values within the JSON must be in ${language}.`
    };

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: prescriptionAnalysisSchema
        }
    }));

    try {
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as PrescriptionAnalysisResult;
    } catch (e) {
        console.error("Failed to parse JSON from prescription analysis:", response.text);
        throw new Error("The model returned an invalid data format for the prescription.");
    }
};

const botCommandSchema = (pages: Page[]) => ({
    type: Type.OBJECT,
    properties: {
        action: {
            type: Type.STRING,
            enum: ['navigate', 'speak'],
            description: "The action to perform. 'navigate' to change pages, 'speak' for a standard text response."
        },
        page: {
            type: Type.STRING,
            enum: pages,
            description: "The target page for navigation. Only used when action is 'navigate'."
        },
        responseText: {
            type: Type.STRING,
            description: "The text response to speak to the user. This is used for both 'speak' actions and as a confirmation for 'navigate' actions."
        }
    },
    required: ["action", "responseText"]
});

export const getBotCommand = async (prompt: string, language: string, availablePages: Page[]): Promise<BotCommandResponse> => {
    const systemPrompt = `You are a voice assistant for a health app called GeoSick. Your primary goal is to help the user navigate the app or answer their health-related questions.

Current Language for response: ${language}.

Analyze the user's request: "${prompt}"

Based on the request, decide on one of two actions:
1. 'navigate': If the user expresses intent to go to a specific section of the app.
2. 'speak': If the user is asking a general question, making a statement, or if the intent is unclear.

The available pages for navigation are: ${availablePages.join(', ')}.
You must map user requests to these exact page names. Here are some examples:
- "scan my area", "analyze a photo" -> 'image-analysis'
- "read my doctor's note", "check this prescription" -> 'prescription-analysis'
- "how am I feeling", "mental health check" -> 'mental-health'
- "what's wrong with me", "I feel sick", "check my symptoms" -> 'symptom-checker'
- "show my past activity", "what have I done" -> 'activity-history'
- "my account", "show my profile" -> 'profile'
- "who made this", "tell me about this app" -> 'about'
- "how can I contact you" -> 'contact'
- "explore the world", "show me the globe" -> 'explore'
- "go home", "take me to the dashboard" -> 'welcome'
- "show me the latest news", "what are the alerts" -> 'live-alerts'

Your response MUST be a single, valid JSON object conforming to the provided schema.
- If the action is 'navigate', 'responseText' should be a brief confirmation message (e.g., "Okay, navigating to the symptom checker.") in the requested language.
- If the action is 'speak', 'responseText' should be a helpful, conversational answer to their question in the requested language. If it's a health question, provide general information and always advise consulting a healthcare professional. DO NOT give a medical diagnosis.

Respond in ${language}.`;

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: systemPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: botCommandSchema(availablePages),
        }
    }));

    try {
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as BotCommandResponse;
    } catch (e) {
        console.error("Failed to parse bot command response:", response.text, e);
        throw new Error("The model returned an invalid data format for the bot command.");
    }
};


const geocodingSchema = {
    type: Type.OBJECT,
    properties: {
        lat: { type: Type.NUMBER, description: "The precise latitude of the found location." },
        lng: { type: Type.NUMBER, description: "The precise longitude of the found location." },
        foundLocationName: { type: Type.STRING, description: "The full, official name of the location found, e.g., 'Eiffel Tower, Paris, France'." },
    },
    required: ["lat", "lng", "foundLocationName"]
};

export const geocodeLocation = async (locationQuery: string): Promise<{ lat: number, lng: number, foundLocationName: string }> => {
    const cacheKey = `geocode_${locationQuery.toLowerCase().trim()}`;
    const cached = cache.get<{ lat: number, lng: number, foundLocationName: string }>(cacheKey);
    if (cached) {
        return cached;
    }
    
    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Find the precise geographic coordinates (latitude and longitude) and the full, official name for the following location: "${locationQuery}". Prioritize accuracy. Respond only with the JSON object.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: geocodingSchema,
        }
    }));

    try {
        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);
        cache.set(cacheKey, result, 1440);
        return result;
    } catch (e) {
        console.error("Failed to parse geocoding response:", response.text);
        throw new Error("The model returned an invalid data format for geocoding.");
    }
};

const facilitiesSchema = {
    type: Type.ARRAY,
    description: "A list of nearby medical facilities.",
    items: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: "The official name of the facility." },
            type: { type: Type.STRING, enum: ['Hospital', 'Clinic', 'Pharmacy'], description: "The type of facility. Must be one of: 'Hospital', 'Clinic', or 'Pharmacy'." },
            lat: { type: Type.NUMBER, description: "The precise latitude of the facility." },
            lng: { type: Type.NUMBER, description: "The precise longitude of the facility." }
        },
        required: ["name", "type", "lat", "lng"]
    }
};

export const findFacilitiesByCoordinates = async (coords: { lat: number; lng: number }): Promise<Omit<Facility, 'distance'>[]> => {
    // For pin-point accuracy, we avoid long-term caching of facility searches based on precise coords, 
    // or use a very specific key. 
    const cacheKey = `facilities_grounded_${coords.lat.toFixed(4)}_${coords.lng.toFixed(4)}`;
    const cached = cache.get<Omit<Facility, 'distance'>[]>(cacheKey);
    if (cached) {
        return cached;
    }

    // Step 1: Use Google Maps Grounding with SPECIFIC toolConfig for location context
    // This retrievalConfig forces the model to look specifically around the coordinates provided.
    const groundingResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Find the specific hospitals, clinics, and pharmacies nearest to latitude ${coords.lat}, longitude ${coords.lng}. Return their names and accurate addresses or locations.`,
        config: {
            tools: [{ googleMaps: {} }],
            toolConfig: {
                retrievalConfig: {
                    latLng: {
                        latitude: coords.lat,
                        longitude: coords.lng
                    }
                }
            }
        } as any // Cast because toolConfig type definition might vary slightly in some SDK versions, but structure is per documentation.
    }));

    // Step 2: Structure the data into JSON
    const structuringResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Extract the medical facilities from the text below into a JSON array.
        For each facility, provide:
        - name: The name of the facility.
        - type: One of 'Hospital', 'Clinic', 'Pharmacy'. Infer from name if needed.
        - lat: The latitude.
        - lng: The longitude.
        
        CRITICAL: You MUST extract the exact latitude and longitude for each facility from the source text. 
        If the source text does not have coordinates, use your internal knowledge to provide the REAL coordinates for that specific named facility.
        Do not return 0,0.
        
        Text: ${groundingResponse.text}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: facilitiesSchema,
        }
    }));

    try {
        const jsonText = structuringResponse.text.trim();
        const result = JSON.parse(jsonText) as Omit<Facility, 'distance'>[];
        
        const validResults = result.filter(f => f.lat !== 0 && f.lng !== 0);
        
        if (validResults.length > 0) {
             cache.set(cacheKey, validResults, 30); // Cache for 30 minutes
             return validResults;
        } else {
             return [];
        }
    } catch (e) {
        console.error("Failed to parse facilities response:", structuringResponse.text);
        return [];
    }
};

const healthForecastSchema = {
    type: Type.OBJECT,
    properties: {
        locationName: { type: Type.STRING, description: "The name of the location for the forecast (e.g., 'San Francisco, CA')." },
        summary: { type: Type.STRING, description: "A brief, 1-2 sentence summary of the day's health outlook." },
        riskFactors: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of the risk factor (e.g., 'Air Quality Index', 'UV Index')." },
                    level: { type: Type.STRING, description: "Risk level: 'Low', 'Moderate', 'High', or 'Very High'." },
                    description: { type: Type.STRING, description: "A brief explanation of the risk." }
                },
                required: ["name", "level", "description"]
            }
        },
        recommendations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "A list of actionable health recommendations for the day."
        }
    },
    required: ["locationName", "summary", "riskFactors", "recommendations"]
};


export const getHealthForecast = async (coords: { lat: number; lng: number }, language: string): Promise<HealthForecast> => {
     const cacheKey = `forecast_${coords.lat.toFixed(2)}_${coords.lng.toFixed(2)}_${language}`;
     const cached = cache.get<HealthForecast>(cacheKey);
     if (cached) {
         return cached;
     }

     const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Generate a daily health forecast for the location at latitude ${coords.lat}, longitude ${coords.lng}. Identify the location name. Include a summary, at least 3 key risk factors (like Air Quality, UV Index, Pollen, Mosquito Activity) with a risk level ('Low', 'Moderate', 'High', 'Very High'), and provide simple, actionable recommendations. The entire response, including all text values inside the JSON, must be in the ${language} language.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: healthForecastSchema,
        }
    }));

    try {
        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText) as HealthForecast;
        cache.set(cacheKey, result, 240);
        return result;
    } catch (e) {
        console.error("Failed to parse health forecast response:", response.text);
        throw new Error("The model returned an invalid data format for the health forecast.");
    }
};

const mentalHealthSchema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING, description: "A gentle, supportive summary of the user's responses, framed as a reflection. Avoid diagnostic language." },
        potentialConcerns: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The general area of concern (e.g., 'Low Mood', 'Anxious Feelings')." },
                    explanation: { type: Type.STRING, description: "A brief, non-judgmental explanation based on the user's answers." }
                },
                required: ["name", "explanation"]
            }
        },
        copingStrategies: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: "Title of the coping strategy (e.g., 'Mindful Breathing')." },
                    description: { type: Type.STRING, description: "A short, actionable description of the strategy." }
                },
                required: ["title", "description"]
            }
        },
        recommendation: { type: Type.STRING, description: "A concluding sentence that gently suggests speaking to a friend, family member, or professional if feelings persist, emphasizing this is not a diagnosis." }
    },
    required: ["summary", "potentialConcerns", "copingStrategies", "recommendation"]
};

export const analyzeMentalHealth = async (answers: Record<string, string>, language: string): Promise<MentalHealthResult> => {
    const prompt = `Act as a compassionate, non-clinical wellness assistant. A user has answered the following questions about their feelings over the last two weeks. The format is "Question": "Answer".
    ${JSON.stringify(answers, null, 2)}
    Based *only* on these answers, provide a supportive reflection.
    1. Write a gentle summary.
    2. Identify 1-2 potential areas for reflection (e.g., low mood, stress). Do NOT use diagnostic terms like "depression" or "anxiety disorder".
    3. Suggest 2-3 general, positive coping strategies (e.g., mindfulness, connecting with nature, talking to a friend).
    4. Conclude with a recommendation to speak with a professional for a real diagnosis if these feelings are persistent.
    Your response must be in JSON format conforming to the provided schema. All text values within the JSON must be in ${language}.`;
    
     const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: mentalHealthSchema,
        }
    }));

    try {
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as MentalHealthResult;
    } catch (e) {
        console.error("Failed to parse mental health response:", response.text);
        throw new Error("The model returned an invalid data format for the mental health analysis.");
    }
};

const symptomAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING, description: "A brief summary of the user's described symptoms." },
        triageRecommendation: { type: Type.STRING, description: "A cautious triage recommendation based on severity. Must be one of: 'Monitor symptoms at home', 'Consider consulting a doctor within a few days', or 'Prompt medical attention is recommended'." },
        potentialConditions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of a potential, common condition that could be related." },
                    description: { type: Type.STRING, description: "A brief, neutral description of the condition and why it might be considered." }
                },
                required: ["name", "description"]
            }
        },
        nextSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "A list of general, safe next steps (e.g., 'Rest and stay hydrated', 'Keep a log of your symptoms')."
        },
        disclaimer: { type: Type.STRING, description: "A clear disclaimer stating this is an AI analysis and not a substitute for professional medical advice." }
    },
    required: ["summary", "triageRecommendation", "potentialConditions", "nextSteps", "disclaimer"]
};

export const analyzeSymptoms = async (symptoms: string, language: string): Promise<SymptomAnalysisResult> => {
    const prompt = `Act as a cautious AI medical informational assistant. A user has described their symptoms: "${symptoms}".
    Analyze this description with extreme caution. Your entire response MUST be in the ${language} language.
    1. Summarize the key symptoms mentioned.
    2. Provide a triage recommendation based on potential severity ('Monitor symptoms at home', 'Consider consulting a doctor within a few days', 'Prompt medical attention is recommended'). Err on the side of caution. For example, mention of chest pain or difficulty breathing should always be 'Prompt medical attention'.
    3. List 2-3 common, potential conditions that a doctor might consider. Do not present these as a diagnosis.
    4. Suggest general, safe next steps.
    5. Provide a strong disclaimer that this is not a medical diagnosis and a doctor must be consulted.
    Your response must be in JSON format conforming to the provided schema. All text values within the JSON must be in ${language}.`;

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: symptomAnalysisSchema,
        }
    }));

    try {
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as SymptomAnalysisResult;
    } catch (e) {
        console.error("Failed to parse symptom analysis response:", response.text);
        throw new Error("The model returned an invalid data format for the symptom analysis.");
    }
};

const liveAlertsSchema = {
    type: Type.ARRAY,
    description: "A list of recent, real-world global health alerts.",
    items: {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING, description: "A concise, headline-style title for the alert (e.g., 'Dengue Fever Cases Rise in Brazil')." },
            location: { type: Type.STRING, description: "The most specific city, region, or area affected (e.g., 'Khovd Province, Mongolia', 'Miami-Dade County, Florida')." },
            country: { type: Type.STRING, description: "The primary country or broad region affected (e.g., 'Mongolia', 'Europe')." },
            locationDetails: { type: Type.STRING, description: "More specific location details if available, like a list of cities or states. If the event is widespread, list the most affected areas. Keep it brief." },
            category: { type: Type.STRING, enum: ['disease', 'air', 'heat', 'environmental', 'other'], description: "The category of the alert." },
            detailedInfo: { type: Type.STRING, description: "A detailed paragraph (3-4 sentences) explaining the situation, what is happening, and the context." },
            threatAnalysis: { type: Type.STRING, description: "A paragraph (2-3 sentences) analyzing the specific threat to the local population and providing brief, actionable advice." },
            lat: { type: Type.NUMBER, description: "The precise latitude of the event's location. Provide this only if it can be accurately determined." },
            lng: { type: Type.NUMBER, description: "The precise longitude of the event's location. Provide this only if it can be accurately determined." }
        },
        required: ["title", "location", "country", "category", "detailedInfo", "threatAnalysis"]
    }
};

export const getLiveHealthAlerts = async (forceRefresh: boolean = false): Promise<Alert[]> => {
    const cacheKey = 'global_alerts';
    if (!forceRefresh) {
        const cached = cache.get<Alert[]>(cacheKey);
        if (cached) return cached;
    }

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: "Act as a global health surveillance system. Use Google Search to find 8 of the most recent and significant real-world public health alerts from around the world from the last 7 days. These can include disease outbreaks, severe air quality warnings, extreme weather events with health implications (like heatwaves), or major environmental health hazards. Extract the key information for each alert.",
        config: {
            tools: [{ googleSearch: {} }],
        }
    }));
    
    const structuringResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the following information, format it into a valid JSON array that adheres to the provided schema. Ensure every field is filled accurately. Text: ${response.text}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: liveAlertsSchema,
        }
    }));

    let alertsData: Omit<Alert, 'id' | 'sources' | 'fetchedAt' | 'source'>[] = [];
    try {
        const jsonText = structuringResponse.text.trim();
        alertsData = JSON.parse(jsonText);
    } catch (e) {
        console.error("Failed to parse JSON from alerts response:", structuringResponse.text);
        throw new Error("The model returned an invalid data format for the health alerts.");
    }

    const geocodingPromises = alertsData.map(alert => {
        if (alert.lat && alert.lng) return Promise.resolve(alert);
        return geocodeLocation(alert.location)
            .then(coords => ({ ...alert, lat: coords.lat, lng: coords.lng }))
            .catch(err => {
                console.warn(`Geocoding failed for "${alert.location}":`, err);
                return alert;
            });
    });

    const geocodedAlerts = await Promise.all(geocodingPromises);

    const sources: AlertSource[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        .map((chunk: any) => ({
            uri: chunk.web.uri,
            title: chunk.web.title,
        }))
        .filter(source => source.uri && source.title);

    const fetchedTimestamp = Date.now();
    const finalAlerts: Alert[] = geocodedAlerts.map((alert, index) => ({
        ...alert,
        id: new Date().toISOString() + index,
        sources: sources,
        fetchedAt: fetchedTimestamp,
        source: 'global',
    }));

    cache.set(cacheKey, finalAlerts, 15);
    return finalAlerts;
};

export const getLocalHealthAlerts = async (lat: number, lng: number, forceRefresh: boolean = false): Promise<Alert[]> => {
    const cacheKey = `local_alerts_${lat.toFixed(2)}_${lng.toFixed(2)}`;
    if (!forceRefresh) {
        const cached = cache.get<Alert[]>(cacheKey);
        if (cached) return cached;
    }

    const response = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Act as a local health surveillance system. Use Google Search to find up to 4 of the most recent and significant public health alerts specifically relevant to the city or region at latitude ${lat}, longitude ${lng} from the last 7 days. Focus on localized events like specific air quality warnings, local disease clusters, or environmental issues for this area. Extract key information for each alert.`,
        config: {
            tools: [{ googleSearch: {} }],
        }
    }));

    if (!response.text.trim()) {
        cache.set(cacheKey, [], 15);
        return [];
    }
    
    const structuringResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the following information, format it into a valid JSON array that adheres to the provided schema. If there is no information, return an empty array. Ensure every field is filled accurately. Text: ${response.text}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: liveAlertsSchema,
        }
    }));

    let alertsData: Omit<Alert, 'id' | 'sources' | 'fetchedAt' | 'source'>[] = [];
    try {
        const jsonText = structuringResponse.text.trim();
        if (jsonText) {
             alertsData = JSON.parse(jsonText);
        }
    } catch (e) {
        console.error("Failed to parse JSON from local alerts response:", structuringResponse.text);
        cache.set(cacheKey, [], 15);
        return [];
    }
    
    if (!Array.isArray(alertsData) || alertsData.length === 0) {
        cache.set(cacheKey, [], 15);
        return [];
    }

    const geocodingPromises = alertsData.map(alert => {
        if (alert.lat && alert.lng) return Promise.resolve(alert);
        return geocodeLocation(alert.location)
            .then(coords => ({ ...alert, lat: coords.lat, lng: coords.lng }))
            .catch(err => {
                console.warn(`Geocoding failed for local alert "${alert.location}":`, err);
                return alert;
            });
    });

    const geocodedAlerts = await Promise.all(geocodingPromises);

    const sources: AlertSource[] = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        .map((chunk: any) => ({
            uri: chunk.web.uri,
            title: chunk.web.title,
        }))
        .filter(source => source.uri && source.title);

    const fetchedTimestamp = Date.now();
    const finalAlerts: Alert[] = geocodedAlerts.map((alert, index) => ({
        ...alert,
        id: new Date().toISOString() + '-local-' + index,
        sources: sources,
        fetchedAt: fetchedTimestamp,
        source: 'local',
    }));
    
    cache.set(cacheKey, finalAlerts, 15);
    return finalAlerts;
};


const cityHealthSnapshotSchema = {
    type: Type.OBJECT,
    properties: {
        cityName: { type: Type.STRING },
        country: { type: Type.STRING },
        lastUpdated: { type: Type.STRING, description: "A brief statement about the time frame of the data, e.g., 'Data based on reports from the last 30 days'." },
        overallSummary: { type: Type.STRING, description: "A 2-3 sentence summary of the current public health situation in the city." },
        diseases: {
            type: Type.ARRAY,
            description: "A list of 3-4 of the most discussed or prevalent diseases in the city based on recent public data.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of the disease (e.g., 'Influenza', 'Dengue Fever')." },
                    summary: { type: Type.STRING, description: "A brief summary of the situation regarding this specific disease." },
                    reportedCases: { type: Type.STRING, description: "An estimated or reported number of cases. Must be a descriptive string, not a number (e.g., 'Approximately 5,000 cases reported', 'Hundreds of cases weekly', 'Data not specified'). Do not invent numbers if not found." },
                    affectedDemographics: { type: Type.STRING, description: "A text description of the most affected demographics (e.g., 'Primarily affecting children under 5', 'Higher incidence in elderly populations', 'No specific demographic reported')." },
                    trend: { type: Type.STRING, enum: ['Increasing', 'Stable', 'Decreasing', 'Unknown'], description: "The recent trend of reported cases." }
                },
                required: ["name", "summary", "reportedCases", "affectedDemographics", "trend"]
            }
        },
        dataDisclaimer: { type: Type.STRING, description: "A mandatory disclaimer about the nature of the data." }
    },
    required: ["cityName", "country", "lastUpdated", "overallSummary", "diseases", "dataDisclaimer"]
};

export const getCityHealthSnapshot = async (cityName: string, country: string, language: string): Promise<CityHealthSnapshot> => {
    const cacheKey = `snapshot_${cityName.replace(' ','')}_${country.replace(' ','')}_${language}`;
    const cached = cache.get<CityHealthSnapshot>(cacheKey);
    if (cached) {
        return cached;
    }

    const groundingPrompt = `Act as a public health intelligence analyst. Your task is to use Google Search to gather the most recent, publicly available information (from news, health ministries, WHO reports from the last 30-60 days) on infectious and prevalent diseases for the city of ${cityName}, ${country}. Your goal is to create a concise public health snapshot. Collect information on the 3-4 most discussed diseases, including a summary, trend, estimated cases, and affected demographics. Also find a brief overall summary. The response must be in ${language}.`;

    const groundingResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: groundingPrompt,
        config: {
            tools: [{ googleSearch: {} }],
        }
    }));

    const structuringPrompt = `Based on the following public health information for ${cityName}, ${country}, format it into a single, valid JSON object that conforms to the provided schema. The entire response, including all text values inside the JSON, MUST be in the ${language} language.

Information:
${groundingResponse.text}

Instructions:
1.  Identify the 3-4 most discussed or significant diseases.
2.  For each disease, provide a brief summary, the recent trend ('Increasing', 'Stable', 'Decreasing', or 'Unknown'), an *estimation* of reported cases (as a descriptive string, e.g., 'Hundreds of cases', not a precise number), and describe the most affected demographics.
3.  Write a brief overall summary of the city's current health situation.
4.  For the 'lastUpdated' field, use "Data based on reports from the last 30-60 days".
5.  For the 'dataDisclaimer' field, you MUST use this exact text: "This is an AI-generated summary of publicly available information and is not real-time, verified medical data. Consult official public health sources for accurate statistics."
`;
    
    const structuringResponse = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: structuringPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: cityHealthSnapshotSchema,
        }
    }));


    try {
        const jsonText = structuringResponse.text.trim();
        const snapshotData = JSON.parse(jsonText) as Omit<CityHealthSnapshot, 'sources'>;

        const sources: AlertSource[] = (groundingResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
            .map((chunk: any) => ({
                uri: chunk.web.uri,
                title: chunk.web.title,
            }))
            .filter(source => source.uri && source.title);
        
        const result = {
            ...snapshotData,
            sources: sources,
        };

        cache.set(cacheKey, result, 360);
        return result;

    } catch (e) {
        console.error("Failed to parse city health snapshot response:", structuringResponse.text, e);
        throw new Error("The model returned an invalid data format for the city health snapshot.");
    }
};