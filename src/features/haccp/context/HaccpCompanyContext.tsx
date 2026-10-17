import {createContext,useContext} from 'react';
import type {CompanyId} from '../../../shared/types';

export const HaccpCompanyContext = createContext<CompanyId>('taebaek');

export const useHaccpCompany = (): CompanyId => useContext(HaccpCompanyContext);
