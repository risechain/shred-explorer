import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testEndpoint() {
  try {
    const apiKey = process.env.API_SECRET_KEY;
    
    if (!apiKey) {
      console.error('Error: API_SECRET_KEY not found in environment variables');
      return;
    }
    
    const response = await fetch('http://localhost:8080/api/stats', {
      headers: {
        'x-api-key': apiKey
      }
    });
    
    const data = await response.json();
    console.log('Response from stats endpoint:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testEndpoint();