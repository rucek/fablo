import defaults from "./defaults";
import { CAJson, OrdererJson, OrgJson, PeerJson } from "../types/FabloConfigJson";
import {
  CAConfig,
  FabloRestConfig,
  FabloRestLoggingConfig,
  HyperledgerExplorerConfig,
  NetworkSettings,
  OrdererConfig,
  OrdererGroup,
  OrgConfig,
  PeerConfig,
} from "../types/FabloConfigExtended";
import _ = require("lodash");

const extendCaConfig = (
  caJsonFormat: CAJson,
  orgName: string,
  orgDomainJsonFormat: string,
  caExposePort: number,
): CAConfig => {
  const ca = caJsonFormat || defaults.ca;
  const address = `${ca.prefix}.${orgDomainJsonFormat}`;
  const port = 7054;
  return {
    prefix: ca.prefix,
    address,
    port,
    exposePort: caExposePort,
    fullAddress: `${address}:${port}`,
    caAdminNameVar: `${orgName.toUpperCase()}_CA_ADMIN_NAME`,
    caAdminPassVar: `${orgName.toUpperCase()}_CA_ADMIN_PASSWORD`,
  };
};

const extendOrderersConfig = (
  headOrdererPort: number,
  groupName: string,
  ordererJson: OrdererJson,
  ordererOrgDomainJson: string,
): OrdererConfig[] => {
  const consensus = ordererJson.type === "raft" ? "etcdraft" : ordererJson.type;
  const prefix = ordererJson.prefix ?? defaults.orderer.prefix;

  return Array(ordererJson.instances)
    .fill(undefined)
    .map((_x, i) => {
      const name = `${prefix}${i}.${groupName}`;
      const address = `${name}.${ordererOrgDomainJson}`;
      const port = headOrdererPort + i;
      return {
        name,
        address,
        domain: ordererOrgDomainJson,
        consensus,
        port,
        fullAddress: `${address}:${port}`,
      };
    });
};

const portsForOrdererGroups = (headOrdererPort: number, orderersJson: OrdererJson[]) => {
  const instancesArray = orderersJson
    .map((o) => o.instances)
    .reduce((arr, n) => [...arr, arr.length === 0 ? n : arr[arr.length - 1] + n], [] as number[]);
  return instancesArray.map((_instance, index) => {
    const port = index == 0 ? headOrdererPort : instancesArray[index - 1] + headOrdererPort;
    return port;
  });
};

const extendOrderersGroupForOrg = (
  headOrdererPort: number,
  orgName: string,
  orderersJson: OrdererJson[],
  ordererOrgDomainJson: string,
): OrdererGroup[] => {
  const portsArray = portsForOrdererGroups(headOrdererPort, orderersJson);

  return orderersJson.map((ordererJson, i) => {
    const groupName = ordererJson.groupName;
    const consensus = ordererJson.type === "raft" ? "etcdraft" : ordererJson.type;
    const orderers = extendOrderersConfig(portsArray[i], groupName, ordererJson, ordererOrgDomainJson);

    const profileName = _.upperFirst(`${groupName}Genesis`);
    const genesisBlockName = `${profileName}.block`;
    const configtxOrdererDefaults = _.upperFirst(`${groupName}Defaults`);

    return {
      name: groupName,
      consensus,
      configtxOrdererDefaults,
      profileName,
      genesisBlockName,
      hostingOrgs: [orgName],
      orderers,
      ordererHeads: [orderers[0]],
    };
  });
};

const extendPeers = (
  peerJson: PeerJson,
  domainJsonFormat: string,
  headPeerPort: number,
  headPeerCouchDbExposePort: number,
): PeerConfig[] => {
  const peerPrefix = peerJson.prefix || defaults.peer.prefix;
  const db = peerJson.db || defaults.peer.db;
  const anchorPeerInstances = peerJson.anchorPeerInstances || defaults.peer.anchorPeerInstances(peerJson.instances);

  return Array(peerJson.instances)
    .fill(undefined)
    .map((_x, i) => {
      const address = `${peerPrefix}${i}.${domainJsonFormat}`;
      const port = headPeerPort + i;
      return {
        name: `${peerPrefix}${i}`,
        address,
        db,
        isAnchorPeer: i < anchorPeerInstances,
        port,
        fullAddress: `${address}:${port}`,
        couchDbExposePort: headPeerCouchDbExposePort + i,
      };
    });
};

interface AnchorPeerConfig extends PeerConfig {
  isAnchorPeer: true;
  orgDomain: string;
}

const fabloRestLoggingConfig = (network: NetworkSettings): FabloRestLoggingConfig => {
  const console = "console";
  if (network.monitoring.loglevel.toLowerCase() === "error") return { error: console };
  if (network.monitoring.loglevel.toLowerCase() === "warn") return { error: console, warn: console };
  if (network.monitoring.loglevel.toLowerCase() === "info") return { error: console, warn: console, info: console };
  return { error: console, warn: console, info: console, debug: console };
};

const fabloRestConfig = (
  domain: string,
  mspName: string,
  port: number,
  ca: CAConfig,
  anchorPeersAllOrgs: AnchorPeerConfig[],
  networkSettings: NetworkSettings,
): FabloRestConfig => {
  const discoveryEndpointsConfig = networkSettings.tls
    ? {
        discoveryUrls: anchorPeersAllOrgs.map((p) => `grpcs://${p.address}:${p.port}`).join(","),
        discoverySslTargetNameOverrides: "",
        discoveryTlsCaCertFiles: anchorPeersAllOrgs
          .map((p) => `/crypto/${p.orgDomain}/peers/${p.address}/tls/ca.crt`)
          .join(","),
      }
    : {
        discoveryUrls: anchorPeersAllOrgs.map((p) => `grpc://${p.address}:${p.port}`).join(","),
        discoverySslTargetNameOverrides: "",
        discoveryTlsCaCertFiles: "",
      };

  return {
    address: `fablo-rest.${domain}`,
    mspId: mspName,
    port,
    fabricCaUrl: `http://${ca.address}:${ca.port}`,
    fabricCaName: ca.address,
    ...discoveryEndpointsConfig,
    logging: fabloRestLoggingConfig(networkSettings),
  };
};

const hyperledgerExplorerConfig = (domain: string, port: number): HyperledgerExplorerConfig => {
  return {
    address: `explorer.${domain}`,
    port,
  };
};

const extendOrgConfig = (
  orgJsonFormat: OrgJson,
  caExposePort: number,
  ordererHeadExposePort: number,
  fabloRestPort: number,
  hyperledgerExplorerPort: number,
  peers: PeerConfig[],
  anchorPeersAllOrgs: AnchorPeerConfig[],
  networkSettings: NetworkSettings,
): OrgConfig => {
  const cryptoConfigFileName = `crypto-config-${orgJsonFormat.organization.name.toLowerCase()}`;
  const { domain, name } = orgJsonFormat.organization;
  const ca = extendCaConfig(orgJsonFormat.ca, name, domain, caExposePort);
  const mspName = orgJsonFormat.organization.mspName || defaults.organization.mspName(name);
  const anchorPeers = peers.filter((p) => p.isAnchorPeer);
  const bootstrapPeersList = anchorPeers.map((a) => a.fullAddress);
  const bootstrapPeersStringParam =
    bootstrapPeersList.length === 1
      ? bootstrapPeersList[0] // note no quotes in parameter
      : `"${bootstrapPeersList.join(" ")}"`;

  const fabloRest = !orgJsonFormat?.tools?.fabloRest
    ? {}
    : { fabloRest: fabloRestConfig(domain, mspName, fabloRestPort, ca, anchorPeersAllOrgs, networkSettings) };

  const hyperledgerExplorer = !orgJsonFormat?.tools?.hyperledgerExplorer
    ? {}
    : { hyperledgerExplorer: hyperledgerExplorerConfig(domain, hyperledgerExplorerPort) };

  const ordererGroups =
    orgJsonFormat.orderers !== undefined
      ? extendOrderersGroupForOrg(ordererHeadExposePort, name, orgJsonFormat.orderers, domain)
      : [];

  return {
    name,
    mspName,
    domain,
    cryptoConfigFileName,
    peersCount: peers.length,
    peers,
    anchorPeers,
    bootstrapPeers: bootstrapPeersStringParam,
    ca,
    cli: {
      address: `cli.${orgJsonFormat.organization.domain}`,
    },
    headPeer: peers[0],
    ordererGroups,
    tools: { ...fabloRest, ...hyperledgerExplorer },
  };
};

const getPortsForOrg = (orgIndex: number) => ({
  caPort: 7020 + 20 * orgIndex,
  headPeerPort: 7021 + 20 * orgIndex,
  headOrdererPort: 7030 + 20 * orgIndex,
  headPeerCouchDbPort: 5080 + 20 * orgIndex,
  fabloRestPort: 8800 + orgIndex,
  hyperledgerExplorerPort: 7010 + orgIndex,
});

const extendOrgsConfig = (orgsJsonConfigFormat: OrgJson[], networkSettings: NetworkSettings): OrgConfig[] => {
  const peersByOrgDomain = orgsJsonConfigFormat.reduce((all, orgJson, orgIndex) => {
    const domain = orgJson.organization.domain;
    const { caPort, headPeerPort, headPeerCouchDbPort, fabloRestPort, hyperledgerExplorerPort } = getPortsForOrg(
      orgIndex,
    );
    const peers =
      orgJson.peer !== undefined ? extendPeers(orgJson.peer, domain, headPeerPort, headPeerCouchDbPort) : [];
    return { ...all, [domain]: { peers, caPort, fabloRestPort, hyperledgerExplorerPort } };
  }, {} as Record<string, { peers: PeerConfig[]; caPort: number; fabloRestPort: number; hyperledgerExplorerPort: number }>);

  const anchorPeers = orgsJsonConfigFormat.reduce((peers, org) => {
    const newAnchorPeers: AnchorPeerConfig[] = peersByOrgDomain[org.organization.domain].peers
      .filter((p) => p.isAnchorPeer)
      .map((p) => ({ ...p, isAnchorPeer: true, orgDomain: org.organization.domain }));
    return peers.concat(newAnchorPeers);
  }, [] as AnchorPeerConfig[]);

  return orgsJsonConfigFormat.map((org, orgIndex) => {
    const { headOrdererPort } = getPortsForOrg(orgIndex);
    const { peers, caPort, fabloRestPort, hyperledgerExplorerPort } = peersByOrgDomain[org.organization.domain];
    return extendOrgConfig(
      org,
      caPort,
      headOrdererPort,
      fabloRestPort,
      hyperledgerExplorerPort,
      peers,
      anchorPeers,
      networkSettings,
    );
  });
};

export { extendOrgsConfig };
