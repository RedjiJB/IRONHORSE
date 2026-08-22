// Phase 2 slice 4 verification: the fleet/vehicles domain -- vehicles,
// vehicle_telemetry, crew_telemetry, trips -- re-expressed from v1's
// fieldops-system as the requirements baseline (not copied code). Fully
// separate from the inventory/logistics slice (no shared table). Focuses
// on the load-bearing rules from that requirements research: one open
// trip per vehicle at a time (DB-enforced), distance/duration computed
// from sparse telemetry (null when fewer than 2 points), the
// reuse-address-if-nearby decision, and a WhatsApp location share writing
// to crew_telemetry always and vehicle_telemetry only when exactly one
// vehicle resolves to that crew member as its driver.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { registerSite } from "../src/domain/sites.js";
import { getVehicle, listVehicles, registerVehicle } from "../src/domain/vehicles.js";
import { listVehicleTelemetry, logLocationShare, logVehicleTelemetry } from "../src/domain/telemetry.js";
import { endTrip, listTrips, startTrip } from "../src/domain/trips.js";

let driverId: string;
let passengerId: string; // no assigned vehicle
let vehicleOwnerId: string; // used only for the plain vehicle-registration test, kept separate so driverId ends up assigned to exactly one vehicle by the time the logLocationShare test runs
let siteId: string;
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdVehicleIds: string[] = [];
const createdTripIds: string[] = [];
const createdSiteIds: string[] = [];

beforeAll(async () => {
  const driver = await registerCrewMember({ name: "QA Fleet Driver", phone: "+15559990901" });
  driverId = driver.id;
  createdCrewIds.push(driver.id);
  createdCrewDids.push(driver.did);

  const passenger = await registerCrewMember({ name: "QA Fleet Passenger", phone: "+15559990902" });
  passengerId = passenger.id;
  createdCrewIds.push(passenger.id);
  createdCrewDids.push(passenger.did);

  const owner = await registerCrewMember({ name: "QA Fleet Vehicle Owner", phone: "+15559990903" });
  vehicleOwnerId = owner.id;
  createdCrewIds.push(owner.id);
  createdCrewDids.push(owner.did);

  const site = await registerSite({ name: "QA Fleet Site", type: "job_site" });
  siteId = site.id;
  createdSiteIds.push(site.id);
});

afterAll(async () => {
  await pool.query("DELETE FROM trips WHERE id = ANY($1)", [createdTripIds]);
  await pool.query("DELETE FROM vehicle_telemetry WHERE vehicle_id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM crew_telemetry WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM vehicles WHERE id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.end();
});

describe("vehicles", () => {
  it("registers a vehicle and reads it back with its latest location", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-001", assignedCrewId: vehicleOwnerId });
    createdVehicleIds.push(vehicle.id);

    const fresh = await getVehicle(vehicle.id);
    expect(fresh?.latest_location).toBeNull();

    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.4215, lng: -75.6972 });
    const withLocation = await getVehicle(vehicle.id);
    expect(withLocation?.latest_location).toMatchObject({ lat: 45.4215, lng: -75.6972 });

    const listed = await listVehicles({ assignedCrewId: vehicleOwnerId });
    expect(listed.map((v) => v.id)).toContain(vehicle.id);
  });
});

describe("telemetry", () => {
  it("reuses the last address within 100m, but not beyond it", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-002" });
    createdVehicleIds.push(vehicle.id);

    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.4215, lng: -75.6972, address: "123 Test St" });

    // ~11m away -- within the 100m reuse radius, no address supplied.
    const nearby = await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.42159, lng: -75.6972 });
    expect(nearby.address).toBe("123 Test St");

    // ~2.2km away -- well outside the reuse radius, no address supplied.
    const far = await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.44, lng: -75.72 });
    expect(far.address).toBeNull();
  });

  it("a location share from a crew member with an assigned vehicle logs to both streams; one without a vehicle only logs to their own", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-003", assignedCrewId: driverId });
    createdVehicleIds.push(vehicle.id);

    const withVehicle = await logLocationShare({ crewMemberId: driverId, lat: 45.4215, lng: -75.6972 });
    expect(withVehicle.crewTelemetry).toBeTruthy();
    expect(withVehicle.vehicleTelemetry?.vehicle_id).toBe(vehicle.id);

    const withoutVehicle = await logLocationShare({ crewMemberId: passengerId, lat: 45.4215, lng: -75.6972 });
    expect(withoutVehicle.crewTelemetry).toBeTruthy();
    expect(withoutVehicle.vehicleTelemetry).toBeNull();
  });
});

describe("trips", () => {
  it("a vehicle can only have one open trip at a time -- enforced at the DB level", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-004" });
    createdVehicleIds.push(vehicle.id);

    const first = await startTrip({ vehicleId: vehicle.id, driverId });
    expect(first.ok).toBe(true);
    if (first.ok) createdTripIds.push(first.trip.id);

    const second = await startTrip({ vehicleId: vehicle.id, driverId: passengerId });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("vehicle_has_open_trip");
  });

  it("ending a trip computes duration_seconds and a haversine-summed distance_meters from telemetry in the window", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-005" });
    createdVehicleIds.push(vehicle.id);

    const trip = await startTrip({ vehicleId: vehicle.id, driverId, siteId, purposeTag: "dump run" });
    expect(trip.ok).toBe(true);
    if (!trip.ok) return;
    createdTripIds.push(trip.trip.id);

    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.4215, lng: -75.6972 });
    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.43, lng: -75.7 });

    const points = await listVehicleTelemetry(vehicle.id);
    expect(points.length).toBe(2);

    const ended = await endTrip(trip.trip.id);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.trip.ended_at).toBeTruthy();
    expect(ended.trip.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(ended.trip.distance_meters).toBeGreaterThan(0);

    const trips = await listTrips({ vehicleId: vehicle.id });
    expect(trips.map((t) => t.id)).toContain(trip.trip.id);
  });

  it("distance_meters stays null with fewer than 2 telemetry points -- 'no data', not 'no movement'", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-006" });
    createdVehicleIds.push(vehicle.id);

    const trip = await startTrip({ vehicleId: vehicle.id, driverId });
    expect(trip.ok).toBe(true);
    if (!trip.ok) return;
    createdTripIds.push(trip.trip.id);

    const ended = await endTrip(trip.trip.id);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.trip.distance_meters).toBeNull();
  });

  it("ending an already-ended trip is denied; ending a nonexistent trip is denied", async () => {
    const vehicle = await registerVehicle({ plate: "QA-TEST-007" });
    createdVehicleIds.push(vehicle.id);
    const trip = await startTrip({ vehicleId: vehicle.id, driverId });
    expect(trip.ok).toBe(true);
    if (!trip.ok) return;
    createdTripIds.push(trip.trip.id);

    await endTrip(trip.trip.id);
    const secondEnd = await endTrip(trip.trip.id);
    expect(secondEnd.ok).toBe(false);
    if (!secondEnd.ok) expect(secondEnd.reason).toBe("already_ended");

    const missing = await endTrip("00000000-0000-0000-0000-000000000000");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("not_found");
  });
});
