// One theme menu and platform-default policy for both application hosts.
export const themes = [
  {label:'Platform default',value:'platform'},
  {label:'Omarchy',value:'omarchy'},
  {label:'Visual Flow',value:'visuals'},
];
export function validTheme(value) { return themes.some(theme=>theme.value===value); }
export function appearanceFor(value, platform) {
  return validTheme(value) && value!=='platform' ? value : platform==='linux'?'omarchy':'visuals';
}
