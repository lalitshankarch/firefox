/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";
const { ModelHubProvider } = ChromeUtils.importESModule(
  "resource://gre/modules/addons/ModelHubProvider.sys.mjs"
);
ChromeUtils.defineESModuleGetters(this, {
  sinon: "resource://testing-common/Sinon.sys.mjs",
});
createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "1");
AddonTestUtils.init(this);

const MODELHUBPROVIDER_PREF = "browser.ml.modelHubProvider";

function ensureBrowserDelayedStartupFinished() {
  // ModelHubProvider does not register itself until the application startup
  // has been completed, and so we simulate that by firing this notification.
  Services.obs.notifyObservers(null, "browser-delayed-startup-finished");
}

add_setup(async () => {
  await promiseStartupManager();
});

add_task(
  {
    pref_set: [[MODELHUBPROVIDER_PREF, false]],
  },
  async function test_modelhub_provider_disabled() {
    ensureBrowserDelayedStartupFinished();
    ok(
      !AddonManager.hasProvider("ModelHubProvider"),
      "Expect no ModelHubProvider to be registered"
    );
  }
);

add_task(
  {
    pref_set: [[MODELHUBPROVIDER_PREF, true]],
  },
  async function test_modelhub_provider_enabled() {
    ensureBrowserDelayedStartupFinished();
    ok(
      AddonManager.hasProvider("ModelHubProvider"),
      "Expect ModelHubProvider to be registered"
    );
  }
);

add_task(
  {
    pref_set: [[MODELHUBPROVIDER_PREF, true]],
  },
  async function test_modelhub_provider_addon_wrappers() {
    let sandbox = sinon.createSandbox();
    await ModelHubProvider.clearAddonCache();
    // Sanity checks.
    ok(
      AddonManager.hasProvider("ModelHubProvider"),
      "Expect ModelHubProvider to be registered"
    );
    Assert.deepEqual(
      await AddonManager.getAddonsByTypes(["mlmodel"]),
      [],
      "Expect getAddonsByTypes result to be initially empty"
    );
    Assert.ok(
      ModelHubProvider.modelHub,
      "Expect modelHub instance to be found"
    );

    const mockModels = [
      {
        name: "model-hub.mozilla.org/org1/model-mock-1",
        revision: "mockRevision1",
        engineIds: [],
      },
      {
        name: "huggingface.co/org2/model-mock-2",
        revision: "mockRevision2",
        engineIds: [],
      },
    ];
    const mockListFilesResult = {
      metadata: {
        totalSize: 2048,
        lastUsed: new Date("2023-10-01T12:00:00Z"),
        updateDate: 0,
      },
    };

    const mockModelShortNames = ["model-mock-1", "model-mock-2"];
    const mockModelsHomepageURLs = [
      "https://huggingface.co/org1/model-mock-1/",
      "https://huggingface.co/org2/model-mock-2/",
    ];

    const listModelsStub = sinon
      .stub(ModelHubProvider.modelHub, "listModels")
      .resolves(mockModels);

    const listFilesStub = sinon
      .stub(ModelHubProvider.modelHub, "listFiles")
      .resolves(mockListFilesResult);

    const getOwnerIcon = sinon
      .stub(ModelHubProvider.modelHub, "getOwnerIcon")
      .resolves("chrome://mozapps/skin/extensions/extensionGeneric.svg");

    const modelWrappers = await AddonManager.getAddonsByTypes(["mlmodel"]);

    // Check that the stubs were called the expected number of times.
    Assert.equal(
      listModelsStub.callCount,
      1,
      "listModels() getting all models only once"
    );
    Assert.equal(
      listFilesStub.callCount,
      mockModels.length,
      "listFiles() getting files and file metadata once for each model"
    );

    Assert.equal(
      getOwnerIcon.callCount,
      mockModels.length,
      "getOwnerIcon() getting image blob once for each model"
    );

    // Verify that the listFiles was called with the expected arguments.
    for (let i = 0; i < mockModels.length; i++) {
      // ListFiles only has one argument, which is an config object
      const callArgs = listFilesStub.getCall(i).args[0];

      Assert.ok(callArgs, `listFiles call ${i} received arguments`);
      // Compare the model name and revision arguments to the mockModels.
      Assert.equal(
        callArgs.model,
        mockModels[i].name,
        `Correct model name for call ${i}`
      );
      Assert.equal(
        callArgs.revision,
        mockModels[i].revision,
        `Correct revision for call ${i}`
      );
    }

    Assert.equal(
      modelWrappers.length,
      mockModels.length,
      "Got the expected number of model AddonWrapper instances"
    );

    for (const [idx, modelWrapper] of modelWrappers.entries()) {
      const { name, revision } = mockModels[idx];
      verifyModelAddonWrapper(modelWrapper, {
        model: name,
        name: mockModelShortNames[idx],
        version: revision,
        lastUsed: mockListFilesResult.metadata.lastUsed,
        totalSize: mockListFilesResult.metadata.totalSize,
        modelHomepageURL: mockModelsHomepageURLs[idx],
      });
    }

    // Verify that the ModelHubProvider.getAddonsByTypes
    // doesn't return any entry if mlmodel isn't explicitly
    // requested.
    Assert.deepEqual(
      (await AddonManager.getAddonsByTypes()).filter(
        addon => addon.type === "mlmodel"
      ),
      [],
      "Expect no mlmodel results with getAddonsByTypes()"
    );

    Assert.deepEqual(
      (await AddonManager.getAddonsByTypes([])).filter(
        addon => addon.type === "mlmodel"
      ),
      [],
      "Expect no mlmodel results with getAddonsByTypes([])"
    );

    Assert.deepEqual(
      (await AddonManager.getAddonsByTypes(["extension"])).filter(
        addon => addon.type === "mlmodel"
      ),
      [],
      "Expect no mlmodel result with getAddonsByTypes(['extension'])"
    );

    Assert.equal(
      await AddonManager.getAddonByID(modelWrappers[0].id),
      modelWrappers[0],
      `Got the expected result from getAddonByID for ${modelWrappers[0].id}`
    );

    // Selecting first model wrapper to test uninstall.
    const modelWrapper = modelWrappers[0];
    const uninstallPromise = AddonTestUtils.promiseAddonEvent("onUninstalled");
    await modelWrapper.uninstall();

    const [uninstalled] = await uninstallPromise;
    equal(
      uninstalled,
      modelWrapper,
      "onUninstalled was called with that wrapper"
    );

    // We expect getAddonByID for the removed model to not be found.
    Assert.equal(
      await AddonManager.getAddonByID(modelWrappers[0].id),
      null,
      `Got no model wrapper from getAddonByID for uninstalled ${modelWrappers[0].id}`
    );

    // We expect getAddonByID for the non removed model to still be found.
    Assert.equal(
      await AddonManager.getAddonByID(modelWrappers[1].id),
      modelWrappers[1],
      `Got the expected result from getAddonByID for ${modelWrappers[1].id}`
    );

    // Reset all sinon stubs.
    sandbox.restore();

    function verifyModelAddonWrapper(modelWrapper, expected) {
      const { name, model, version, lastUsed, modelHomepageURL } = expected;
      info(`Verify model addon wrapper for ${name}:${version}`);
      const expectedId = ModelHubProvider.getWrapperIdForModel({
        name: model,
        revision: version,
      });
      Assert.equal(modelWrapper.id, expectedId, "Got the expected id");
      Assert.equal(modelWrapper.type, "mlmodel", "Got the expected type");
      Assert.equal(
        modelWrapper.permissions,
        AddonManager.PERM_CAN_UNINSTALL,
        "Got the expected permissions"
      );
      Assert.equal(modelWrapper.model, model, "Got the expected name patch");
      Assert.equal(modelWrapper.name, name, "Got the expected name");
      Assert.equal(modelWrapper.version, version, "Got the expected version");
      Assert.equal(
        modelWrapper.lastUsed.toISOString(),
        lastUsed.toISOString(),
        "Got the expected lastUsed"
      );
      Assert.equal(
        modelWrapper.totalSize,
        expected.totalSize,
        "Got the expected file size"
      );
      Assert.equal(
        modelWrapper.isActive,
        true,
        "Expect model AddonWrapper to be active"
      );
      Assert.equal(
        modelWrapper.isCompatible,
        true,
        "Expect model AddonWrapper to be compatible"
      );
      Assert.equal(
        modelWrapper.modelHomepageURL,
        modelHomepageURL,
        "Got the expect model homepage URL"
      );
    }
  }
);
