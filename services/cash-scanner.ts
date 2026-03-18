const ROBOFLOW_API_KEY = process.env.EXPO_PUBLIC_ROBOFLOW_API_KEY ?? '';
const ROBOFLOW_MODEL_URL = 'https://detect.roboflow.com/currency-note-detection-hmfqa/1';

export interface DetectedNote {
  currency: string;
  denomination: number;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface ScanResult {
  notes: DetectedNote[];
  totalByCurrency: Record<string, number>;
  imageUri: string;
}

/**
 * Send a captured image to Roboflow for currency detection.
 * The image is sent as base64 to the Roboflow inference API.
 */
export async function detectCurrency(imageBase64: string): Promise<DetectedNote[]> {
  try {
    const response = await fetch(
      `${ROBOFLOW_MODEL_URL}?api_key=${ROBOFLOW_API_KEY}&confidence=40&overlap=30`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: imageBase64,
      },
    );

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      return [];
    }

    return data.predictions.map((pred: any) => parsePrediction(pred));
  } catch (error) {
    console.error('Roboflow detection error:', error);
    throw new Error('Failed to detect currency. Please try again.');
  }
}

/**
 * Parse a Roboflow prediction into our DetectedNote format.
 * The class name from the model typically encodes currency + denomination,
 * e.g. "AED-100", "USD-20", "PHP-500".
 */
function parsePrediction(prediction: any): DetectedNote {
  const className: string = prediction.class ?? '';
  const parts = className.split('-');

  let currency = 'UNKNOWN';
  let denomination = 0;

  if (parts.length >= 2) {
    currency = parts[0].toUpperCase();
    denomination = parseInt(parts[1], 10) || 0;
  } else {
    // Try to infer from the class name
    const denomMatch = className.match(/(\d+)/);
    denomination = denomMatch ? parseInt(denomMatch[1], 10) : 0;

    if (/aed|dirham/i.test(className)) currency = 'AED';
    else if (/usd|dollar/i.test(className)) currency = 'USD';
    else if (/eur|euro/i.test(className)) currency = 'EUR';
    else if (/php|peso/i.test(className)) currency = 'PHP';
  }

  return {
    currency,
    denomination,
    confidence: prediction.confidence ?? 0,
    bbox: {
      x: prediction.x ?? 0,
      y: prediction.y ?? 0,
      width: prediction.width ?? 0,
      height: prediction.height ?? 0,
    },
  };
}

/**
 * Aggregate detected notes into totals per currency.
 */
export function aggregateNotes(notes: DetectedNote[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const note of notes) {
    if (note.currency !== 'UNKNOWN' && note.denomination > 0) {
      totals[note.currency] = (totals[note.currency] ?? 0) + note.denomination;
    }
  }
  return totals;
}

/**
 * Convert a local image URI to a base64 string for sending to the API.
 */
export async function imageToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
