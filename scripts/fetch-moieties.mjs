#!/usr/bin/env node
/**
 * Fetches the linker–payload moieties of marketed ADCs from PubChem.
 *
 * The INN suffix of an ADC names its moiety — the `-vedotin` of brentuximab
 * vedotin is mc-Val-Cit-PAB-MMAE — and PubChem has each as a compound. This
 * writes them to scripts/lib/moieties.json, with the CID, the formula PubChem
 * states and the date, so the drawings in the examples come from a record that
 * can be looked up rather than from anyone's memory.
 *
 * Run it again to refresh:  node scripts/fetch-moieties.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** INN moiety -> what it is, and how it joins the antibody. See linkers.mjs. */
const WANTED = {
  vedotin: { join: 'maleimide', what: 'mc-Val-Cit-PAB-MMAE' },
  emtansine: { join: 'nhs-ester', what: 'MCC-DM1' },
  deruxtecan: { join: 'maleimide', what: 'mc-GGFG-DXd' },
  govitecan: { join: 'maleimide', what: 'CL2A-SN-38' },
  mafodotin: { join: 'maleimide', what: 'mc-MMAF' },
  soravtansine: { join: 'carboxyl', what: 'sulfo-SPDB-DM4' },
  tesirine: { join: 'maleimide', what: 'mal-PEG8-Val-Ala-PABC-PBD dimer' },
  ozogamicin: { join: 'amide', what: 'AcBut hydrazone / N-acetyl-γ-calicheamicin' },
  sunirine: { join: 'maleimide', what: 'sulfonated DGN549C indolinobenzodiazepine' },
};

/** PubChem resolves some of these by name and some only by CID. */
const CIDS = {
  vedotin: 46944733,
  emtansine: 92131096,
  deruxtecan: 118305111,
  govitecan: 89983570,
  mafodotin: 56949327,
  soravtansine: 91667591,
  tesirine: 73672523,
  ozogamicin: 9942071,
  sunirine: 163184692,
};

const out = { fetched: new Date().toISOString().slice(0, 10), source: 'PubChem PUG REST', moieties: {} };

for (const [name, meta] of Object.entries(WANTED)) {
  const cid = CIDS[name];
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,SMILES,InChI/JSON`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const record = (await response.json()).PropertyTable.Properties[0];
  if (record.CID !== cid) throw new Error(`${name}: asked for ${cid}, got ${record.CID}`);
  // The InChI carries its own formula; the two agreeing is the check that the
  // record is internally consistent before anything is drawn from it.
  const inchiFormula = record.InChI.split('/')[1];
  if (inchiFormula !== record.MolecularFormula) {
    throw new Error(`${name}: formula ${record.MolecularFormula} but InChI says ${inchiFormula}`);
  }
  out.moieties[name] = {
    cid,
    what: meta.what,
    join: meta.join,
    formula: record.MolecularFormula,
    smiles: record.SMILES,
  };
  console.log(`${name.padEnd(14)} CID ${String(cid).padEnd(10)} ${record.MolecularFormula}`);
}

writeFileSync(resolve(root, 'scripts/lib/moieties.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote scripts/lib/moieties.json (${Object.keys(out.moieties).length} moieties)`);
