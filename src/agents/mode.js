const { agentKaynakToken, agentRehberToken, agentStackToken } = require("../config");

function agentsEnabled() {
  return Boolean(agentStackToken && agentKaynakToken && agentRehberToken);
}

module.exports = { agentsEnabled };
