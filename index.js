var bitops = require('./lib/bitops');
var utils = require('./lib/utils');

var RESP = {};
var CLIENT_KEY = 'Client Key';
var SERVER_KEY = 'Server Key';

function base64decode(s) {
    if (atob) {
        return Uint8Array.from(atob(s), function(c) { return c.charCodeAt(0); });
    } else {
        return Uint8Array.from(Buffer.from(s, 'base64'));
    }
}

function base64encode(s) {
   if (btoa) {
       return btoa(s);
   } else {
       return Buffer.from(s).toString('base64');
   }
}

function Mechanism(options) {
    options = options || {};
    this._genNonce = options.genNonce || utils.genNonce;
    this._stage = 'initial';
}

// Conform to the SASL lib's expectations
Mechanism.Mechanism = Mechanism;


Mechanism.prototype.name = 'SCRAM-SHA-1';
Mechanism.prototype.clientFirst = true;


Mechanism.prototype.response = function (cred) {
    return RESP[this._stage](this, cred);
};

Mechanism.prototype.challenge = function (chal) {
    var values = utils.parse(chal);

    this._salt = base64decode(values.s || '');
    this._iterationCount = parseInt(values.i, 10);
    this._nonce = values.r;
    this._verifier = values.v;
    this._error = values.e;
    this._challenge = chal;

    return this;
};


RESP.initial = function (mech, cred) {
    mech._cnonce = mech._genNonce();

    var authzid = '';
    if (cred.authzid) {
        authzid = 'a=' + utils.saslname(cred.authzid);
    }

    mech._gs2Header = 'n,' + authzid + ',';

    var nonce = 'r=' + mech._cnonce;
    var username = 'n=' + utils.saslname(cred.username || '');

    mech._clientFirstMessageBare = username + ',' + nonce;
    var result = mech._gs2Header + mech._clientFirstMessageBare;

    mech._stage = 'challenge';

    return result;
};


RESP.challenge = function (mech, cred) {
    var gs2Header = base64encode(mech._gs2Header);

    mech._clientFinalMessageWithoutProof = 'c=' + gs2Header + ',r=' + mech._nonce;

    var saltedPassword, clientKey, serverKey;

    // If our cached salt is the same, we can reuse cached credentials to speed
    // up the hashing process.
    if (cred.salt && cred.salt.every(function(value, index) { return value === mech._salt[index]; })) {
        if (cred.clientKey && cred.serverKey) {
            clientKey = cred.clientKey;
            serverKey = cred.serverKey;
        } else if (cred.saltedPassword) {
            saltedPassword = cred.saltedPassword;
            clientKey = bitops.HMAC(saltedPassword, CLIENT_KEY);
            serverKey = bitops.HMAC(saltedPassword, SERVER_KEY);
        }
    } else {
        saltedPassword = bitops.Hi(cred.password || '', mech._salt, mech._iterationCount);
        clientKey = bitops.HMAC(saltedPassword, CLIENT_KEY);
        serverKey = bitops.HMAC(saltedPassword, SERVER_KEY);
    }

    var storedKey = bitops.H(clientKey);
    var authMessage = mech._clientFirstMessageBare + ',' +
                      mech._challenge + ',' +
                      mech._clientFinalMessageWithoutProof;
    var clientSignature = bitops.HMAC(storedKey, authMessage);

    var clientProof = base64encode(String.fromCharCode.apply(null, bitops.XOR(clientKey, clientSignature)));

    mech._serverSignature = bitops.HMAC(serverKey, authMessage);

    var result = mech._clientFinalMessageWithoutProof + ',p=' + clientProof;

    mech._stage = 'final';

    mech.cache = {
        salt: mech._salt,
        saltedPassword: saltedPassword,
        clientKey: clientKey,
        serverKey: serverKey
    };

    return result;
};

RESP.final = function () {
    // TODO: Signal errors
    return '';
};



module.exports = Mechanism;
