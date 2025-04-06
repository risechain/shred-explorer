import { NextRequest, NextResponse } from 'next/server';

/**
 * Catch-all API proxy route
 * This provides a single proxy for all backend API requests while keeping the API key secure
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, (await params).path, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params.path, 'POST');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params.path, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return handleRequest(request, params.path, 'DELETE');
}

/**
 * Helper function to handle proxying requests to the backend API
 */
async function handleRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string
) {
  try {
    // Reconstruct the path
    const path = pathSegments.join('/');
    
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const queryPart = queryString ? `?${queryString}` : '';
    
    // Get the backend API URL and key from environment variables
    const apiUrl = process.env.API_URL || 'http://localhost:3001/api';
    const apiKey = process.env.API_SECRET_KEY;
    
    if (!apiKey) {
      console.warn('API_SECRET_KEY not configured in environment variables');
      return NextResponse.json(
        { status: 'error', message: 'API configuration error' },
        { status: 500 }
      );
    }
    
    // Get the request body for methods that support it
    let body = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        body = await request.json();
      } else {
        body = await request.text();
      }
    }
    
    // Make the request to the backend API with the server-side API key
    const backendUrl = `${apiUrl}/${path}${queryPart}`;
    const response = await fetch(backendUrl, {
      method,
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        'x-api-key': apiKey,
      },
      body: body === undefined ? undefined : 
            typeof body === 'string' ? body : JSON.stringify(body),
      // Helps with caching and keeping responses fresh
      cache: 'no-store',
    });
    
    if (!response.ok) {
      console.error(`Backend API responded with status: ${response.status}`);
      return NextResponse.json(
        { 
          status: 'error', 
          message: `Backend error: ${response.status}`, 
          path: `${path}${queryPart}`
        },
        { status: response.status }
      );
    }
    
    // Get the response from the backend
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data);
    } else {
      const text = await response.text();
      return new NextResponse(text, {
        status: response.status,
        headers: {
          'Content-Type': contentType || 'text/plain',
        },
      });
    }
  } catch (error) {
    console.error('Error proxying request to backend:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to proxy request to backend' },
      { status: 500 }
    );
  }
}