import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MatterData from "../../../../../../src/data/matter";
import type { DeviceRegistryEntry } from "../../../../../../src/data/device/device_registry";
import type { ExtEntityRegistryEntry } from "../../../../../../src/data/entity/entity_registry";
import type { HomeAssistant } from "../../../../../../src/types";

const commissionMatterDevice = vi.fn();
const getExtendedEntityRegistryEntries = vi.fn();
let reportNewDevice: (device: DeviceRegistryEntry) => void;

vi.mock("../../../../../../src/data/matter", async (importOriginal) => ({
  ...(await importOriginal<typeof MatterData>()),
  commissionMatterDevice: (...args: unknown[]) =>
    commissionMatterDevice(...args),
  watchForNewMatterDevice: (
    _hass: HomeAssistant,
    callback: (device: DeviceRegistryEntry) => void
  ) => {
    reportNewDevice = callback;
    return () => undefined;
  },
}));

vi.mock(
  "../../../../../../src/data/entity/entity_registry",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getExtendedEntityRegistryEntries: (...args: unknown[]) =>
      getExtendedEntityRegistryEntries(...args),
  })
);

await import("../../../../../../src/panels/config/integrations/integration-panels/matter/dialog-matter-add-device");

const shade = {
  id: "shade",
  name: "Shade",
  identifiers: [["matter", "deviceid_ABC-0000000000000050-MatterNodeDevice"]],
} as unknown as DeviceRegistryEntry;

const doorEntry = (entity_id: string) =>
  ({
    entity_id,
    device_id: "shade",
    original_device_class: "door",
  }) as unknown as ExtEntityRegistryEntry;

describe("dialog-matter-add-device", () => {
  let dialog: HTMLElement & {
    hass: HomeAssistant;
    showDialog: () => void;
  };

  // As in dialog-matter-open-commissioning-window.test.ts: the flow only shows in private state.
  const internals = () => dialog as unknown as Record<string, unknown>;
  const step = () => internals()["_step"];

  const hassWith = (
    hasMatterStatusReport: boolean,
    entityIds: string[] = []
  ): HomeAssistant =>
    ({
      auth: { external: { config: { hasMatterStatusReport } } },
      entities: Object.fromEntries(
        entityIds.map((entity_id) => [
          entity_id,
          { entity_id, device_id: "shade", labels: [] },
        ])
      ),
      localize: (key: string) => key,
    }) as unknown as HomeAssistant;

  beforeEach(() => {
    commissionMatterDevice.mockReset();
    getExtendedEntityRegistryEntries.mockReset();
    getExtendedEntityRegistryEntries.mockImplementation(
      (_hass: HomeAssistant, ids: string[]) =>
        Promise.resolve(
          Object.fromEntries(ids.map((id) => [id, doorEntry(id)]))
        )
    );
    dialog = document.createElement(
      "dialog-matter-add-device"
    ) as typeof dialog;
  });

  it("shows the added device after commissioning with a pasted code, which the app does not report on", async () => {
    dialog.hass = hassWith(true);
    dialog.showDialog();
    internals()["_step"] = "generic";
    internals()["_pairingCode"] = "34970112332";
    commissionMatterDevice.mockResolvedValue({});

    await (internals()["_addDevice"] as () => Promise<void>)();
    reportNewDevice(shade);

    expect(step()).toBe("device_added");
  });

  it("waits for the app to finish when the app commissions the device", () => {
    dialog.hass = hassWith(true);
    dialog.showDialog();
    internals()["_step"] = "new";

    reportNewDevice(shade);
    expect(step()).toBe("new");

    window.dispatchEvent(
      new CustomEvent("matter-commission-finish", {
        detail: { name: null, success: true },
      })
    );
    expect(step()).toBe("device_added");
  });

  it("offers the device class of the new node's entity, not one left on the device by an earlier node", async () => {
    dialog.hass = hassWith(false, ["binary_sensor.shade_door"]);
    dialog.showDialog();

    reportNewDevice(shade);
    await Promise.resolve();
    dialog.hass = hassWith(false, [
      "binary_sensor.shade_door",
      "binary_sensor.shade_door_2",
    ]);
    await (internals()["_fetchMainEntity"] as () => Promise<void>)();

    expect(
      (internals()["_mainEntity"] as ExtEntityRegistryEntry | undefined)
        ?.entity_id
    ).toBe("binary_sensor.shade_door_2");
  });
});
