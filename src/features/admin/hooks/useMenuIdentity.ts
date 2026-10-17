import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';

export function useMenuIdentity() {
  const [menuIdentity, setMenuIdentity] = useState<{uid:string;employeeId:string;companyId:string;admin:boolean}|null>(null);
  useEffect(() => {
    let live=true, generation=0;
    const stop=onAuthStateChanged(auth,user=>{
      const captured=++generation;setMenuIdentity(null);
      if(!user)return;
      void user.getIdTokenResult().then(({claims})=>{
        if(live && captured===generation && auth.currentUser?.uid===user.uid && typeof claims.employeeId==='string' && typeof claims.companyId==='string')
          setMenuIdentity({uid:user.uid,employeeId:claims.employeeId,companyId:claims.companyId,admin:claims.isAdmin===true});
      }).catch(()=>{if(live&&captured===generation)setMenuIdentity(null);});
    });
    return()=>{live=false;generation++;stop();};
  },[]);
  return menuIdentity;
}
