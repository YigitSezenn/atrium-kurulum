let suppressedUntil = 0;

function suppressAudit(ms) {
  suppressedUntil = Date.now() + ms;
}

function isAuditSuppressed() {
  return Date.now() < suppressedUntil;
}

module.exports = { suppressAudit, isAuditSuppressed };
