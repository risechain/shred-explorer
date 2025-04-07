import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') || '10';
    const offset = searchParams.get('offset') || '0';
    
    // Get the backend API URL from environment variables
    const apiUrl = process.env.API_URL || 'http://localhost:3001/api';
    const apiKey = process.env.API_SECRET_KEY;
    
    // Make the request to the backend API
    const response = await fetch(`${apiUrl}/blocks/latest?limit=${limit}&offset=${offset}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      // Important for real-time data
      cache: 'no-store'
    });
    
    if (!response.ok) {
      console.error(`Backend API responded with status: ${response.status}`);
      return NextResponse.json(
        { status: 'error', message: 'Failed to fetch blocks' },
        { status: response.status }
      );
    }
    
    // Return the data directly
    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}