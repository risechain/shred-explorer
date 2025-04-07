import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get the backend API URL from environment variables
    const apiUrl = process.env.API_URL || 'http://localhost:3001/api';
    const apiKey = process.env.API_SECRET_KEY;
    
    // Make the request to the backend API
    const headers = new Headers({
      'Content-Type': 'application/json',
    });
    
    // Only add API key if it exists
    if (apiKey) {
      headers.append('x-api-key', apiKey);
    }
    
    const response = await fetch(`${apiUrl}/stats`, {
      headers,
      // Important for real-time data
      cache: 'no-store'
    });
    
    if (!response.ok) {
      console.error(`Backend API responded with status: ${response.status}`);
      return NextResponse.json(
        { status: 'error', message: 'Failed to fetch stats' },
        { status: response.status }
      );
    }
    
    // Return the data directly
    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}