import fetch from 'node-fetch';

async function testEndpoint() {
  try {
    const response = await fetch('http://localhost:8080/api/stats');
    const data = await response.json();
    console.log('Response from stats endpoint:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testEndpoint();