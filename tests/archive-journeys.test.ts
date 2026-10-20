import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveJourney, isWritableArchivePage } from '../src/lib/pairing/archive';

const text = (value: string) => ({ rich_text: [{ plain_text: value }] });
const title = (value: string) => ({ title: [{ plain_text: value }] });

test('archive maps actual Notion properties without filling absent fields with demo values', () => {
  const page = {
    id: 'notion-page-1',
    properties: {
      'Passenger ID': text('PAX-TEST0001'), 'Flight ID': title('FL-TEST-001'),
      'Status': { select: { name: 'landed' } },
      'Takeoff Time': { date: { start: '2026-10-20T00:00:00+08:00' } },
      'Client Time Zone': text('Asia/Taipei'),
      'Landing Time': { date: { start: '2026-10-20T07:00:00+08:00' } },
      'Departure Location': text('Taipei, Taiwan'), 'Arrival Location': text('Hong Kong'),
      'Departure Airport Code': text('TPE'), 'Arrival Airport Code': text('HKG'),
      'Departure Latitude': { number: 25.03 }, 'Departure Longitude': { number: 121.56 },
      'Arrival Latitude': { number: 22.32 }, 'Arrival Longitude': { number: 114.17 },
      'Immigration Note': text('A real note from Notion'),
      'Files & media': { files: [{ type: 'external', external: { url: 'https://example.com/real.jpg' } }] },
    },
  };
  const journey = archiveJourney(page, 'PAX-TEST0001');
  assert.ok(journey);
  assert.equal(journey.flightNumber, 'FL-TEST-001');
  assert.equal(journey.origin.airportCode, 'TPE');
  assert.equal(journey.destination.city, 'Hong Kong');
  assert.equal(journey.destination.country, '');
  assert.equal(journey.durationMinutes, 420);
  assert.equal(journey.timeZone, 'Asia/Taipei');
  assert.equal(journey.note, 'A real note from Notion');
  assert.equal(journey.imageUrl, 'https://example.com/real.jpg');
  assert.equal(journey.status, 'completed');
  assert.equal(archiveJourney(page, 'PAX-OTHER0001'), null);
  assert.equal(isWritableArchivePage(page, 'PAX-TEST0001', 'FL-TEST-001'), true);
  assert.equal(isWritableArchivePage(page, 'PAX-OTHER0001', 'FL-TEST-001'), false);
  assert.equal(isWritableArchivePage(page, 'PAX-TEST0001', 'FL-OTHER'), false);
});

test('an unfinished row remains processing and missing values remain empty', () => {
  const page = {
    id: 'notion-page-2',
    properties: {
      'Passenger ID': text('PAX-TEST0001'), 'Flight ID': title('FL-TEST-002'),
      'Status': { select: { name: 'in_flight' } },
      'Takeoff Time': { date: { start: '2026-10-20T00:00:00+08:00' } },
    },
  };
  const journey = archiveJourney(page, 'PAX-TEST0001');
  assert.ok(journey);
  assert.equal(journey.status, 'processing');
  assert.equal(journey.destination.airportCode, '');
  assert.equal(journey.destination.latitude, null);
  assert.equal(journey.direction.degrees, null);
  assert.equal(journey.durationMinutes, null);
  assert.equal(journey.imageUrl, '');
  assert.equal(isWritableArchivePage(page, 'PAX-TEST0001', 'FL-TEST-002'), false);
});
