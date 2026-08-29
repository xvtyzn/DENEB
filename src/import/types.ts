import type { Construct, Diagnostic } from '../model/types';

export interface ImportOptions {
  /**
   * Full sequences by identifier. Tool output that omits the sequence — ANARCI's
   * CSV does — needs these before the constant region can be named.
   */
  sequences?: Record<string, string>;
  /** Name the constant region by matching the references. Default true. */
  identifyConstantRegions?: boolean;
  /** How close a match has to be before it is trusted, 0–1. Default 0.7. */
  minIdentity?: number;
  /** Numbering the tool used. CDR positions are only read for IMGT. */
  scheme?: 'imgt' | 'kabat' | 'chothia' | 'north' | (string & {});
}

export interface ImportResult {
  construct: Construct;
  /** What was assumed, matched or skipped — never thrown. */
  diagnostics: Diagnostic[];
}
