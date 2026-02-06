
import { GoogleGenAI } from "@google/genai";
import { WeeklyPlan, UserProfile } from "../types";

export const analyzePlanWithAI = async (plan: WeeklyPlan, profile: UserProfile): Promise<string> => {
  // Always use the required initialization format with named parameter apiKey
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  
  const systemInstruction = `
    Act as an elite running coach specializing in the Norwegian SINGLE Threshold method and Marathon training.
    IMPORTANT: This is the Norwegian SINGLE approach (one quality session per day), not doubles. 
    Focus on "Control" - staying strictly below the lactate turnpoint.
    Keep the tone encouraging, technical but accessible. Format with simple Markdown headers.
  `;

  const contents = `
    Analyze this training plan for a runner with the following stats:
    - Recent Race: ${profile.raceDistance}m in ${profile.raceTime}
    - Max HR: ${profile.maxHR}
    - Targeted Weekly Volume: ${profile.weeklyVolume} km
    - Actual Plan Volume: ${plan.totalDistance} km
    
    Please provide:
    1. A brief "Coach's Focus" for the week.
    2. Specific advice on how to execute the SINGLE Threshold sessions (pacing vs heart rate for control).
    3. How this volume (${profile.weeklyVolume}km) fits their current profile.
    4. Nutrition tip for the Saturday Long Run.
  `;

  try {
    // Correct way to call generateContent with model, contents, and optional systemInstruction
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
      },
    });
    // Use .text property directly (do not call as a method)
    return response.text || "Could not generate analysis.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "The AI Coach is currently offline. Please try again later.";
  }
};

export const generateGarminWorkoutFile = async (workoutTitle: string, description: string): Promise<string> => {
    // Create new GoogleGenAI instance right before making an API call
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    const prompt = `Generate a JSON structure representing a running workout for: ${workoutTitle}. Description: ${description}. Adhere to a generic workout schema.`;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt
        });
        // Use .text property directly
        return response.text || "";
    } catch (e) {
        console.error("Gemini API Error:", e);
        return "";
    }
}
