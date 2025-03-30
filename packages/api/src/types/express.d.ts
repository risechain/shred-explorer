import { Express as E } from 'express-serve-static-core';

declare global {
  declare namespace Express {
    export interface Express extends E {}
  }
}