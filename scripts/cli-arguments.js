'use strict';

function userArguments(argv = process.argv) {
  const values = Array.isArray(argv) ? argv.slice(2) : [];
  return values[0] === '--' ? values.slice(1) : values;
}

function firstUserArgument(argv = process.argv) {
  return String(userArguments(argv)[0] || '');
}

module.exports = {
  userArguments,
  firstUserArgument
};
