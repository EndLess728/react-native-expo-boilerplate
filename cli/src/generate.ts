import { type ProjectOptions, STYLING_LABEL } from './options.js';
import { applyIdentity } from './steps/identity.js';
import { convertToJavaScript } from './steps/javascript.js';
import { applyNavigation } from './steps/navigation.js';
import { applyPackageManager } from './steps/packageManager.js';
import { writeReadme } from './steps/readme.js';
import { applyState } from './steps/state.js';
import { applyStyling } from './steps/styling.js';
import { applyTooling } from './steps/tooling.js';
import { formatProject } from './steps/format.js';
import { writeManifest } from './manifest.js';
import { copyBaseTemplate } from './template.js';
import { ProjectFiles } from './utils/files.js';
import { PackageJsonEditor } from './utils/packageJson.js';

/**
 * Writes the project to `options.targetDir`. Pure file generation — no
 * installs, no git — so it is fast and easy to test.
 *
 * Order matters: every overlay is written in TypeScript, so the TS → JS pass
 * runs after all of them, and formatting runs last.
 */
export async function generateProject(
  options: ProjectOptions,
  cliVersion: string,
  onStep: (message: string) => void = () => {},
): Promise<void> {
  const files = new ProjectFiles(options.targetDir);

  onStep('Copying the boilerplate');
  await copyBaseTemplate(options.targetDir);
  const pkg = await PackageJsonEditor.load(files);

  onStep(`Setting up ${options.navigation === 'expo-router' ? 'Expo Router' : 'React Navigation'}`);
  await applyNavigation(files, pkg, options);

  onStep(`Setting up ${STYLING_LABEL[options.styling]}`);
  await applyStyling(files, pkg, options);

  onStep(
    options.state === 'zustand'
      ? 'Setting up Zustand'
      : `Setting up Redux Toolkit + ${options.reduxMiddleware === 'saga' ? 'Redux-Saga' : 'thunks'}`,
  );
  await applyState(files, pkg, options);

  onStep('Configuring tooling');
  await applyTooling(files, pkg, options);

  onStep('Naming your app');
  await applyIdentity(files, pkg, options);
  await applyPackageManager(files, pkg, options);

  if (options.language === 'js') {
    onStep('Converting to JavaScript');
    await convertToJavaScript(files, pkg, options);
  }

  await pkg.save();
  await writeReadme(files, options);
  await writeManifest(files, options, cliVersion);

  onStep('Formatting');
  await formatProject(files);
}
