import React, { useEffect, useState } from 'react';
import { Select, Typography, notification } from 'antd';
import {
    ButtonsContainer as SelectionContainer,
    Content,
    Container,
    HeaderImage,
    InstallButton,
    ModelInformationContainer,
    ModelName,
    ModelSmallDesc,
    VersionSelect,
    EngineOptionsContainer,
    EngineOption,
    DownloadProgress,
    UpdateButton,
    InstalledButton,
    CancelButton, DetailsContainer, VersionHistoryContainer, LeftContainer
} from './styles';
import Store from 'electron-store';
import * as fs from "fs";
import Zip from 'adm-zip';
import { Mod, ModTrack, ModVariant } from "renderer/components/App";
import { setupInstallPath } from 'renderer/actions/install-path.utils';
import { DownloadItem, RootStore } from 'renderer/redux/types';
import { useDispatch, useSelector } from 'react-redux';
import { deleteDownload, registerDownload, updateDownloadProgress } from 'renderer/redux/actions/downloads.actions';
import _ from 'lodash';
import { Version, Versions } from "renderer/components/AircraftSection/VersionHistory";

const settings = new Store;

const { Option } = Select;

const { Paragraph } = Typography;

type Props = {
    mod: Mod
}

let controller: AbortController;
let signal: AbortSignal;

const index: React.FC<Props> = (props: Props) => {

    const [selectedVariant] = useState<ModVariant>(props.mod.variants[0]);
    const [selectedTrack, setSelectedTrack] = useState<ModTrack>(handleFindInstalledTrack());
    const [needsUpdate, setNeedsUpdate] = useState<boolean>(false);

    const [isInstalled, setIsInstalled] = useState<boolean>(false);

    const [lastTime, setLastTime] = useState<Date | null>(null);
    const [lastCount, setLastCount] = useState<number | null>(null);

    const download: DownloadItem = useSelector((state: RootStore) => _.find(state.downloads, { id: props.mod.name }));
    const dispatch = useDispatch();

    const isDownloading = download?.progress >= 0;

    useEffect(() => {
        checkForUpdates(selectedTrack);
    },

    []);

    async function getDownloadSpeed() {
        console.log("counter ran");
        console.log(lastTime);
        console.log(lastCount);
        if (lastTime !== null) {
            console.log("time ran");
            if (lastCount !== null) {
                console.log("count ran");
                setLastCount(lastCount + 1);

                if (lastCount === 1000) {
                    setLastCount(0);
                    const newTime = new Date;

                    const deltaTime = newTime.getTime() - lastTime.getTime();

                    console.log(deltaTime);
                }
            } else {
                setLastCount(1);
            }
        } else {
            setLastTime(new Date);
        }
    }

    async function checkForUpdates(track: ModTrack) {
        const localLastUpdate = settings.get('cache.' + props.mod.key + '.lastUpdated');

        const res = await fetch(track.url, { method: 'HEAD' });

        const webLastUpdate = res.headers.get('Last-Modified').toString();

        const installDir = `${settings.get('mainSettings.msfsPackagePath')}\\${props.mod.targetDirectory}\\`;

        if (fs.existsSync(installDir)) {
            setIsInstalled(true);
            if (typeof localLastUpdate === "string") {
                if (localLastUpdate === webLastUpdate) {
                    console.log("Is Updated");
                    setNeedsUpdate(false);
                } else {
                    setNeedsUpdate(true);
                    console.log("Is not Updated");
                }
            } else {
                setIsInstalled(false);
                console.log("Failed");
            }
        } else {
            setIsInstalled(false);
        }
    }

    async function downloadMod(track: ModTrack) {
        if (!isDownloading) {
            dispatch(registerDownload(props.mod.name));
            controller = new AbortController();
            signal = controller.signal;
            console.log("Downloading Track", track);
            const cancelCheck = new Promise((resolve) => {
                resolve(signal);
            });
            const msfsPackageDir = settings.get('mainSettings.msfsPackagePath');

            const fetchResp = await fetch("https://api.flybywiresim.com/api/v1/download?url=" + track.url, { redirect: "follow" });
            console.log("Starting Download");

            const respReader = fetchResp.body.getReader();
            const respLength = +fetchResp.headers.get('Content-Length');
            const respUpdateTime = fetchResp.headers.get('Last-Modified');

            let receivedLength = 0;
            const chunks = [];

            let lastPercentFloor = 0;

            for (;;) {
                try {
                    const { done, value } = await respReader.read();
                    cancelCheck.then((val: AbortSignal) => {
                        signal = val;
                    });
                    if (done || signal.aborted) {
                        setLastTime(null);
                        setLastCount(null);
                        break;
                    }

                    chunks.push(value);
                    receivedLength += value.length;

                    const newPercentFloor = Math.floor((receivedLength / respLength) * 100);

                    console.log("run");
                    getDownloadSpeed();

                    if (lastPercentFloor !== newPercentFloor) {
                        lastPercentFloor = newPercentFloor;
                        dispatch(updateDownloadProgress(props.mod.name, lastPercentFloor));
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        console.log('User aborted download');
                        break;
                    } else {
                        throw e;
                    }
                }
            }

            if (signal.aborted) {
                dispatch(updateDownloadProgress(props.mod.name, 0));
                return;
            }

            const chunksAll = new Uint8Array(respLength);
            let position = 0;
            for (const chunk of chunks) {
                chunksAll.set(chunk, position);
                position += chunk.length;
            }

            const compressedBuffer = Buffer.from(chunksAll);

            if (typeof msfsPackageDir === "string") {
                const zipFile = new Zip(compressedBuffer);
                const modInstallPath = `${msfsPackageDir}\\${props.mod.targetDirectory}`;

                if (fs.existsSync(modInstallPath)) {
                    fs.rmdirSync(modInstallPath, { recursive: true });
                }

                zipFile.extractAllTo(msfsPackageDir);
            }
            dispatch(updateDownloadProgress(props.mod.name, 0));
            setIsInstalled(true);
            setNeedsUpdate(false);
            console.log(props.mod.key);
            settings.set('cache.' + props.mod.key + '.lastUpdated', respUpdateTime);
            settings.set('cache.' + props.mod.key + '.lastInstalledTrack', track.name);
            console.log("Download complete!");
            notification.open({
                placement: 'bottomRight',
                message: `${props.mod.aircraftName}/${track.name} download complete!`
            });
            dispatch(deleteDownload(props.mod.name));
        }
    }

    async function findAndSetTrack(key: string) {
        const newTrack = selectedVariant.tracks.find(x => x.key === key);
        await checkForUpdates(newTrack);
        setSelectedTrack(newTrack);
    }

    function handleInstall() {
        if (settings.has('mainSettings.msfsPackagePath')) {
            downloadMod(selectedTrack);
        } else {
            setupInstallPath();
        }
    }

    function handleUpdate() {
        if (settings.has('mainSettings.msfsPackagePath')) {
            downloadMod(selectedTrack);
        } else {
            setupInstallPath();
        }
    }

    function handleCancel() {
        if (isDownloading) {
            console.log('Cancel download');
            controller.abort();
            dispatch(deleteDownload(props.mod.name));
        }
    }

    function handleFindInstalledTrack() {
        const lastInstalledTrackName = settings.get('cache.' + props.mod.key + '.lastInstalledTrack');

        let lastInstalledTrack = null;

        props.mod.variants[0].tracks.map(track => {
            if (track.name === lastInstalledTrackName) {
                lastInstalledTrack = track;
            }
        });

        if (lastInstalledTrack) {
            return lastInstalledTrack;
        } else {
            return props.mod.variants[0]?.tracks[0];
        }
    }

    function handleLastInstalledTrackName() {
        const name = settings.get('cache.' + props.mod.key + '.lastInstalledTrack');

        if (typeof name === "string") {
            return name;
        } else {
            return "Development";
        }
    }

    return (
        <Container>
            <HeaderImage>
                <ModelInformationContainer>
                    <ModelName>{props.mod.name}</ModelName>
                    <ModelSmallDesc>{props.mod.shortDescription}</ModelSmallDesc>
                </ModelInformationContainer>
                <SelectionContainer>
                    <VersionSelect
                        styling={{ backgroundColor: '#00C2CB', color: 'white' }}
                        defaultValue={handleLastInstalledTrackName()}
                        onSelect={item => findAndSetTrack(item.toString())}
                        disabled={isDownloading}>
                        {
                            selectedVariant.tracks.map(version =>
                                <Option value={version.key} key={version.key}>{version.name}</Option>
                            )
                        }
                    </VersionSelect>
                    {!isInstalled && !isDownloading && <InstallButton onClick={handleInstall} />}
                    {isInstalled && !needsUpdate && !isDownloading && <InstalledButton />}
                    {needsUpdate && !isDownloading && <UpdateButton onClick={handleUpdate}/>}
                    {isDownloading && <CancelButton onClick={handleCancel}>
                        {(download?.progress >= 99) ? "Decompressing" : `${download?.progress}% -  Cancel`}
                    </CancelButton>}
                </SelectionContainer>
            </HeaderImage>
            <DownloadProgress percent={download?.progress} showInfo={false} status="active" />
            <Content>
                <LeftContainer>
                    <DetailsContainer>
                        <h3>Details</h3>
                        <Paragraph style={{ color: '#858585', fontSize: '17px' }}>{props.mod.description}</Paragraph>
                    </DetailsContainer>
                    <EngineOptionsContainer>
                        <h3>Variants</h3>
                        {
                            props.mod.variants.map(variant =>
                                // TODO: Enable onClick when mod variants are available
                                <EngineOption key={variant.key} aria-disabled={!variant.enabled}>
                                    <img src={variant.imageUrl} alt={variant.imageAlt} />
                                    <span>{variant.name}</span>
                                </EngineOption>
                            )
                        }
                    </EngineOptionsContainer>
                </LeftContainer>
                <VersionHistoryContainer>
                    <h3>Version history</h3>
                    <Versions>
                        {
                            props.mod.versions.map((version, idx) =>
                                <Version key={idx} index={idx} version={version} />
                            )
                        }
                    </Versions>
                </VersionHistoryContainer>
            </Content>
        </Container>
    );
};

export default index;
