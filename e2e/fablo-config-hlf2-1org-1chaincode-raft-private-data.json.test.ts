import performTests from "./performTests";

const config = "samples/fablo-config-hlf2-1org-1chaincode-raft-private-data.json";

describe(config, () => {
  performTests(config);
});
