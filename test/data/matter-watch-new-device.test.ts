import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceRegistryEntry } from "../../src/data/device/device_registry";
import type { HomeAssistant } from "../../src/types";

let emit: (devices: DeviceRegistryEntry[]) => void;
const unsubscribe = vi.fn();

vi.mock("../../src/data/ws-device_registry", () => ({
  fetchDeviceRegistry: vi.fn(),
  subscribeDeviceRegistry: (
    _conn: unknown,
    onChange: (devices: DeviceRegistryEntry[]) => void
  ) => {
    emit = onChange;
    return unsubscribe;
  },
}));

const { watchForNewMatterDevice } = await import("../../src/data/matter");

const device = (
  id: string,
  identifiers: [string, string][]
): DeviceRegistryEntry =>
  ({ id, name: id, identifiers }) as unknown as DeviceRegistryEntry;

const node = (nodeId: string): [string, string] => [
  "matter",
  `deviceid_19D51070EB45B939-${nodeId}-MatterNodeDevice`,
];

const shade = device("shade", [
  node("0000000000000013"),
  ["matter", "serial_SN1"],
]);
const lamp = device("lamp", [node("0000000000000040")]);
const zigbee = device("zigbee", [["zha", "00:11:22:33"]]);

/** Core gives every Matter node a `deviceid_` identifier, and its entities a unique ID that starts with it. */
describe("watchForNewMatterDevice", () => {
  const callback = vi.fn();

  beforeEach(() => {
    callback.mockReset();
    unsubscribe.mockReset();
    watchForNewMatterDevice({ connection: {} } as HomeAssistant, callback);
    emit([shade, lamp, zigbee]);
  });

  it("ignores the devices registered when it starts", () => {
    expect(callback).not.toHaveBeenCalled();
  });

  it("reports a device that was not registered before", () => {
    const plug = device("plug", [node("0000000000000051")]);

    emit([shade, lamp, zigbee, plug]);

    expect(callback).toHaveBeenCalledExactlyOnceWith(plug);
  });

  it("reports an existing device that gained a node, as core merges a recommissioned node that shares its serial number", () => {
    const merged = device("shade", [
      ...shade.identifiers,
      node("0000000000000050"),
    ]);

    emit([merged, lamp, zigbee]);

    expect(callback).toHaveBeenCalledExactlyOnceWith(merged);
  });

  it("ignores updates that add no node", () => {
    emit([
      { ...shade, name_by_user: "Dining room shade" },
      device("lamp", [...lamp.identifiers, ["matter", "serial_SN2"]]),
      device("zigbee", [
        ["zha", "00:11:22:33"],
        ["zha", "44:55"],
      ]),
    ]);

    expect(callback).not.toHaveBeenCalled();
  });

  it("reports only the first new node and then stops listening", () => {
    const plug = device("plug", [node("0000000000000051")]);

    emit([shade, lamp, zigbee, plug]);
    emit([
      shade,
      lamp,
      zigbee,
      plug,
      device("bulb", [node("0000000000000052")]),
    ]);

    expect(callback).toHaveBeenCalledExactlyOnceWith(plug);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
