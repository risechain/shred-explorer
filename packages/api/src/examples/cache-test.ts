import fetch from 'node-fetch';

const API_URL = 'http://localhost:3001';

async function testCache() {
  console.log('Testing cache functionality...\n');
  
  // Test 1: Stats endpoint
  console.log('Test 1: Stats endpoint');
  console.time('First stats request');
  await fetch(`${API_URL}/api/stats`);
  console.timeEnd('First stats request');
  
  console.time('Second stats request (should be cached)');
  await fetch(`${API_URL}/api/stats`);
  console.timeEnd('Second stats request (should be cached)');
  
  console.log('\nWaiting 1.5 seconds for cache to expire...');
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  console.time('Third stats request (cache expired)');
  await fetch(`${API_URL}/api/stats`);
  console.timeEnd('Third stats request (cache expired)');
  
  console.log('\n');
  
  // Test 2: Block endpoint
  console.log('Test 2: Block endpoint');
  console.time('First block request');
  await fetch(`${API_URL}/api/blocks/1`);
  console.timeEnd('First block request');
  
  console.time('Second block request (should be cached)');
  await fetch(`${API_URL}/api/blocks/1`);
  console.timeEnd('Second block request (should be cached)');
  
  console.log('\n');
  
  // Test 3: Latest blocks with pagination
  console.log('Test 3: Latest blocks endpoint');
  console.time('First latest blocks request');
  await fetch(`${API_URL}/api/blocks/latest?limit=10&offset=0`);
  console.timeEnd('First latest blocks request');
  
  console.time('Second latest blocks request (should be cached)');
  await fetch(`${API_URL}/api/blocks/latest?limit=10&offset=0`);
  console.timeEnd('Second latest blocks request (should be cached)');
  
  console.time('Different pagination (not cached)');
  await fetch(`${API_URL}/api/blocks/latest?limit=10&offset=10`);
  console.timeEnd('Different pagination (not cached)');
}

testCache()
  .then(() => console.log('\nCache tests completed'))
  .catch(error => console.error('Error:', error));