import {emptyProfile,normalizeProfile} from '../lib/profile.js'
import {validateProfileAction} from './workbench-tool.js'

export function createProfiles(store){
  const read=()=>({...emptyProfile,...store.read('profile',{})})
  function update(input){const next=normalizeProfile(input,read());store.write('profile',next);return next}
  function reset(){store.write('profile',emptyProfile);return read()}
  function execute(input){
    validateProfileAction(input)
    if(input.action==='read')return {profile:read(),message:'已读取画像'}
    const {action,...changes}=input
    return {profile:update(changes),message:'已更新择导画像'}
  }
  return {read,update,reset,execute}
}
