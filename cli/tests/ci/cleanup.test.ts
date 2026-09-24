import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

it.skipIf(process.platform === "win32")(
  "isolates adjacent job cleanup and lets only final parent cleanup collect its children",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cli-cleanup-"));
    const file = join(directory, "state.json");
    const runner = "a".repeat(64);
    const attachments = existsSync("/.dockerenv") ? [runner] : [];

    const labels = (job: string, parent = "parent") => ({
      "dev.cloudreve.worktree": process.cwd(),
      "dev.cloudreve.role": "test",
      "dev.cloudreve.ci-run": job,
      "dev.cloudreve.ci-parent": parent,
    });

    const initial = {
      container: {
        first: { labels: labels("first") },
        second: { labels: labels("second") },
        foreign: { labels: labels("foreign", "other-parent") },
      },
      network: {
        first: { labels: labels("first"), members: [...attachments, "first"] },
        second: { labels: labels("second"), members: [...attachments, "second"] },
        foreign: {
          labels: labels("foreign", "other-parent"),
          members: [...attachments, "foreign"],
        },
      },
      volume: {
        first: { labels: labels("first") },
        second: { labels: labels("second") },
        foreign: { labels: labels("foreign", "other-parent") },
      },
    };

    await writeFile(file, JSON.stringify(initial));

    await writeFile(
      join(directory, "docker"),
      `#!${process.execPath}
const fs=require('node:fs');const file=process.env.FAKE_DOCKER_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8'));const a=process.argv.slice(2);
const runner=${JSON.stringify(runner)};let output='';
if(a[1]==='inspect'){
 if(a[0]==='container'&&a.includes('{{.Id}}'))output=runner;
 else{const value=state[a[0]][a[2]];if(!value)process.exit(1);const template=a.at(-1);
 const key=template.match(/index .*? "([^"]+)"/);output=key?value.labels[key[1]]??'':value.members.join('\\n');}
}else if(a[0]==='ps'||a[1]==='ls'){
 const kind=a[0]==='ps'?'container':a[0];const filter=a[a.indexOf('--filter')+1].slice(6);const at=filter.indexOf('=');
 output=Object.entries(state[kind]).filter(([,v])=>v.labels[filter.slice(0,at)]===filter.slice(at+1)).map(([id])=>id).join('\\n');
}else if(a[0]==='rm'){
 const id=a.at(-1);delete state.container[id];for(const network of Object.values(state.network))network.members=network.members.filter(v=>v!==id);
}else if(a[1]==='disconnect'){state.network[a[2]].members=state.network[a[2]].members.filter(v=>v!==a[3]);
}else if(a[1]==='rm'){
 const id=a[2];if(a[0]==='network'&&state.network[id].members.length)process.exit(2);delete state[a[0]][id];
}else process.exit(3);
fs.writeFileSync(file,JSON.stringify(state));process.stdout.write(output+'\\n');
`,
      { mode: 0o700 },
    );

    const env = {
      ...process.env,
      PATH: directory + ":" + process.env.PATH,
      FAKE_DOCKER_STATE: file,
      CR_CI_RUN_ID: "first",
      CR_CI_PARENT_RUN_ID: "parent",
      CR_CI_CLEANUP_PARENT: "0",
    };

    try {
      execFileSync("bash", [resolve("scripts/ci/cleanup.sh")], {
        env,
        timeout: 15000,
      });

      const remaining = JSON.parse(await readFile(file, "utf8"));

      for (const kind of ["container", "network", "volume"] as const) {
        expect(remaining[kind].first).toBeUndefined();
        expect(remaining[kind].second).toEqual(initial[kind].second);
        expect(remaining[kind].foreign).toEqual(initial[kind].foreign);
      }

      execFileSync("bash", [resolve("scripts/ci/cleanup.sh")], {
        env: { ...env, CR_CI_CLEANUP_PARENT: "1" },
        timeout: 15000,
      });

      const final = JSON.parse(await readFile(file, "utf8"));

      for (const kind of ["container", "network", "volume"] as const) {
        expect(Object.keys(final[kind])).toEqual(["foreign"]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
