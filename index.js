const SPREADSHEET_KEY = '10sbRsHAydaiV6ujP4Bty8TNr29-_vabPzCddNomyKfI';
const USE_CACHED_SIMPLE_DATA = false;

const bank = require('bank');
const creds = process.env.GOOG_SECRETS ?
                JSON.parse(process.env.GOOG_SECRETS) :
                require('./secrets/secrets.json');
const googleSpreadsheet = require('google-spreadsheet');
const moment = require('moment');
const R = require('ramda');

const startEndForCurrentMonth = function () {
  return [
    moment().startOf('month').toDate().getTime(),
    moment().endOf('month').toDate().getTime()
  ];
};

const transactionsInTimeRange = function (range, transactions) {
  return R.compose(
    R.filter(t => t.times.when_recorded >= range[0]),
    R.filter(t => t.times.when_recorded <= range[1])
  )(transactions);
};

// polyfill-safe guard check
if (!Promise.wrap) {
  Promise.wrap = function(fn) {
    return function() {
      var args = [].slice.call( arguments );

      return new Promise( function(resolve,reject){
        fn.apply(
          null,
          args.concat( function(err,v){
            if (err) {
              reject( err );
            }
            else {
              resolve( v );
            }
          } )
        );
      } );
    };
  };
}

var acct = (function () {
  var raw = bank.account({
    username: process.env.SIMPLE_USERNAME,
    password: process.env.SIMPLE_PASSWORD
  });
  return {
    balance: Promise.wrap(raw.balance.bind(raw)),
    login: Promise.wrap(raw.login.bind(raw)),
    transactions: Promise.wrap(raw.transactions.bind(raw))
  };
})();

var rethrowErr = function (err) {
  if (!err) return;
  console.error(err);
  if (err.stack) console.error(err.stack.split('\n'));
  throw err;
};

const updateCurrentBalances = async function (budgetSpreadsheet, balances) {
  return Promise.wrap(budgetSpreadsheet.getCells)(1, {
    'min-row': 2,
    'max-row': 2,
    'min-cell': 'A',
    'max-cell': 'F',
    'return-empty': true
  })
  .then(([currentBalanceCell, goalsCell, unpaidBillsCell, safeToSpendCell, actualMoneyLeft, updatedCell]) => {
    return Promise.all([
      Promise.wrap(currentBalanceCell.setValue)(balances.total/10000-balances.pending/10000),
      Promise.wrap(goalsCell.setValue)(balances.goals/10000),
      Promise.wrap(updatedCell.setValue)((new Date()).toISOString())
    ])
  })
  .then(() => console.log('~> Updated balances.'))
  .catch(rethrowErr);
};

const getWorksheet = async function (spreadsheet, worksheetTitle) {
  return Promise.wrap(spreadsheet.getInfo)()
    .then((data) => {
      let worksheet = R.find(R.propEq('title', worksheetTitle), data.worksheets);
      if (!worksheet) throw new Error('Worksheet with title not found: ' + worksheetTitle);
      return worksheet;
    })
    .catch(rethrowErr);
}

const clearWorksheet = async function (spreadsheet, worksheet, worksheetTitle, startingRow=2) {
  let rows = await getRows(spreadsheet, 2, startingRow, worksheet.rowCount-1);
  return Promise.all(
    rows.map(row => updateRow(spreadsheet, 2, row, R.repeat('', 26)))
  )
  .catch(rethrowErr);
};

const capitalLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const addHeaderRowToWorksheet = async function (spreadsheet, worksheetId, titles) {
  return Promise.wrap(spreadsheet.getCells)(worksheetId, {
    'min-row': 1,
    'max-row': 1,
    'min-cell': 'A',
    'max-cell': capitalLetters[titles.length-1],
    'return-empty': true
  })
  .then((cells) => {
    return Promise.all(titles.map((title, i) => Promise.wrap(cells[i].setValue)(title)))
  })
  .catch(rethrowErr);
};

const getRows = async function (spreadsheet, worksheetId, startRow, endRow) {
  return Promise.wrap(spreadsheet.getCells)(worksheetId, {
    'min-row': startRow,
    'max-row': endRow+1,
    'min-cell': 'A',
    'max-cell': 'Z',
    'return-empty': true
  })
  .then((cells) => R.splitEvery(26, cells))
  .catch(rethrowErr);
};

const jsonFormatToCsvFormat = function (jsonFormatObject) {
  var date = new Date(jsonFormatObject.times.when_recorded);
  jsonFormatObject.geo = jsonFormatObject.geo || {};

  return {
    'Date': date.toISOString().split('T')[0].replace(/-/g, '/'),
    'Recorded at': date.toISOString(),
    'Scheduled for': '',
    'Amount': jsonFormatObject.amounts.amount/10000,
    'Activity': jsonFormatObject.transaction_type || '',
    'Pending': false,
    'Raw description': jsonFormatObject.raw_description || '',
    'Description': jsonFormatObject.description || '',
    'Category folder': jsonFormatObject.categories[0].folder || '',
    'Category': jsonFormatObject.categories[0].name || '',
    'Street address': jsonFormatObject.geo.street || '',
    'City': jsonFormatObject.geo.city || '',
    'State': jsonFormatObject.geo.state || '',
    'Zip': jsonFormatObject.geo.state || '',
    'Latitude': jsonFormatObject.geo.lat || '',
    'Longitude': jsonFormatObject.geo.lon || '',
    'Memo': jsonFormatObject.memo || ''
  };
};

const billsSheetHeaders = [
  'Date',
  'Recorded at',
  'Scheduled for',
  'Amount',
  'Activity',
  'Pending',
  'Raw description',
  'Description',
  'Category folder',
  'Category',
  'Street address',
  'City',
  'State',
  'Zip',
  'Latitude',
  'Longitude',
  'Memo'
];

const updateTransactionsForMonth = async function (budgetSpreadsheet, transactions) {
  let transactionsForMonth = transactionsInTimeRange(startEndForCurrentMonth(), transactions);

  let worksheet = await getWorksheet(budgetSpreadsheet, 'Bills');
  await clearWorksheet(budgetSpreadsheet, worksheet, 'Bills', transactionsForMonth.length+1);
  let rows = await getRows(budgetSpreadsheet, 2, 2, transactionsForMonth.length);
  return Promise.all(transactionsForMonth.map((transaction, i) => {
    return updateRow(budgetSpreadsheet, 2, rows[i], R.values(jsonFormatToCsvFormat(transaction)));
  }))
  .then(() => console.log('~> Updated transactions.'))
  .catch(rethrowErr);
};

const updateRow = function (spreadsheet, worksheetIndex, cells, values) {
  return Promise.wrap(spreadsheet.bulkUpdateCells)(worksheetIndex, cells, values)
    .catch(rethrowErr);
};

const updateGoogleSpreadsheet = function (balances, transactions) {
  const budgetSpreadsheet = new googleSpreadsheet(SPREADSHEET_KEY);
  Promise.wrap(budgetSpreadsheet.useServiceAccountAuth)(creds)
  .then(() => Promise.all([
    updateCurrentBalances(budgetSpreadsheet, balances),
    updateTransactionsForMonth(budgetSpreadsheet, transactions)
  ]))
  .catch(rethrowErr);
};

if (USE_CACHED_SIMPLE_DATA) {
  console.log('populating acct object with cached data');
  acct.balance = () => Promise.resolve(require('./data/balances.json'));
  acct.transactions = () => Promise.resolve(require('./data/transactions.json'));
}

acct
  .login()
  .then(() => Promise.all([acct.balance(), acct.transactions()]))
  .then(([balances, transactions]) => updateGoogleSpreadsheet(balances, transactions.transactions))
  .catch(rethrowErr);
